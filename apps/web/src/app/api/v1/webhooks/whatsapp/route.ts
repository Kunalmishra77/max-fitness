import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { parseWhatsAppWebhook, restartReminders, unsubscribeMember, verifyMetaSignature } from '@mfp/core';
import { PrismaMessageLogWriter, PrismaUnsubscribeUnitOfWork } from '@mfp/db';
import type { E164Mobile } from '@mfp/shared';
import { newRequestId } from '@/lib/api';
import { getContainer } from '@/lib/container';
import { loadGym } from '@/lib/gym';
import { handleInboundWhatsApp } from '@/lib/whatsapp-inbound';

/**
 * `GET|POST /api/v1/webhooks/whatsapp` — what Meta sends back
 * (api-specification.md §4; whatsapp-automation-engine §7; security-plan §3.1).
 *
 * GET is Meta's one-time subscription check. POST carries delivery statuses, button taps
 * and replies: the raw bytes are verified against `X-Hub-Signature-256` before anything
 * is parsed, and every event is stored once (unique on provider + id) so a redelivery
 * cannot unsubscribe someone twice.
 *
 * Meta retries anything that is not a 2xx, so a handler failure answers 500 on purpose —
 * but a batch where one reply failed is still a 200, because the rest was handled.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A batch of statuses is a few kilobytes; anything larger is not Meta. */
const MAX_BODY_BYTES = 512 * 1024;

export function GET(request: NextRequest) {
  const { env } = getContainer();
  const params = request.nextUrl.searchParams;
  const verifyToken = env.WHATSAPP_VERIFY_TOKEN;

  if (params.get('hub.mode') === 'subscribe' && verifyToken !== undefined && verifyToken !== '' && params.get('hub.verify_token') === verifyToken) {
    // Meta expects the challenge echoed as plain text.
    return new NextResponse(params.get('hub.challenge') ?? '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new NextResponse(null, { status: 403 });
}

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const container = getContainer();
  const { env, clock, prisma } = container;

  if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });

  const appSecret = env.WHATSAPP_APP_SECRET;
  if (appSecret === undefined || appSecret === '') {
    console.error(`[webhook-whatsapp] no app secret configured ${requestId}`);
    return new NextResponse(null, { status: 503 });
  }
  if (!verifyMetaSignature(rawBody, request.headers.get('x-hub-signature-256') ?? '', appSecret)) {
    console.warn(`[webhook-whatsapp] signature did not verify ${requestId}`);
    return new NextResponse(null, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const parsed = parseWhatsAppWebhook(body);
  if (parsed.statuses.length === 0 && parsed.replies.length === 0) return NextResponse.json({ ok: true });

  try {
    const gym = await loadGym(container);
    const uow = new PrismaUnsubscribeUnitOfWork(prisma, gym.id);
    const messageLog = new PrismaMessageLogWriter(prisma);

    // One row per event, so a redelivery is visible and cannot act twice.
    const seen = await recordEvents(prisma, gym.id, parsed);

    await handleInboundWhatsApp(
      { statuses: parsed.statuses.filter((status) => seen.has(statusKey(status.providerMessageId, status.status))), replies: parsed.replies.filter((reply) => seen.has(reply.providerMessageId)) },
      {
        clock,
        secret: env.LINK_TOKEN_SECRET,
        restartWindowDays: gym.settings.reminders.restartWindowDays,
        unsubscribe: (memberId) => unsubscribeMember({ memberId }, { clock, gymId: gym.id, uow }),
        restart: (memberId) => restartReminders({ memberId, restartWindowDays: gym.settings.reminders.restartWindowDays }, { clock, gymId: gym.id, uow }),
        membersOnNumber: (mobile: E164Mobile) =>
          prisma.member.findMany({ where: { gymId: gym.id, mobile, deletedAt: null, status: { in: ['ACTIVE', 'PENDING_PAYMENT', 'PENDING_VERIFICATION'] } }, select: { id: true, fullName: true } }),
        updateStatus: (providerMessageId, status, at, error) =>
          messageLog.updateStatus(providerMessageId, status as Parameters<PrismaMessageLogWriter['updateStatus']>[1], at, error ?? undefined),
        alertOwner: async (kind, context) => {
          // A reply or a shared-number STOP is something a person has to read, so it lands
          // as a SYSTEM alert with the words in it; quality problems have their own type.
          await prisma.alert.create({
            data: { gymId: gym.id, type: kind === 'WHATSAPP_QUALITY' ? 'WHATSAPP_QUALITY' : 'SYSTEM', title: `alert.${kind}`, params: context },
          });
        },
      },
    );
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    // Meta retries a non-2xx, which is what we want when the database is briefly down.
    console.error(`[webhook-whatsapp] failed ${requestId}: ${error instanceof Error ? error.name : 'Error'}`);
    return new NextResponse(null, { status: 500 });
  }
}

const statusKey = (providerMessageId: string, status: string) => `${providerMessageId}:${status}`;

/**
 * Store each event once and return the ids that are new to us.
 *
 * A status arrives once per state, so its key carries the state; a message id is unique
 * on its own. The unique index on (provider, externalId) is what makes a redelivery a
 * no-op rather than a second unsubscribe.
 */
async function recordEvents(
  prisma: ReturnType<typeof getContainer>['prisma'],
  gymId: string,
  parsed: ReturnType<typeof parseWhatsAppWebhook>,
): Promise<Set<string>> {
  const rows = [
    ...parsed.statuses.map((status) => ({ externalId: statusKey(status.providerMessageId, status.status), eventType: `status.${status.status}`, payload: { ...status, at: status.at.toISOString() } })),
    ...parsed.replies.map((reply) => ({ externalId: reply.providerMessageId, eventType: `reply.${reply.kind}`, payload: { ...reply, at: reply.at.toISOString() } })),
  ];

  const fresh = new Set<string>();
  for (const row of rows) {
    const { count } = await prisma.webhookEvent.createMany({
      data: [{ gymId, provider: 'whatsapp', externalId: row.externalId, eventType: row.eventType, signatureOk: true, payload: row.payload, processedAt: new Date() }],
      skipDuplicates: true,
    });
    if (count === 1) fresh.add(row.externalId);
  }
  return fresh;
}
