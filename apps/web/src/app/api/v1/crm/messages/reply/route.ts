import type { NextRequest } from 'next/server';
import { can, serviceWindow } from '@mfp/core';
import { PrismaMessageLogWriter } from '@mfp/db';
import { todayIST, type E164Mobile } from '@mfp/shared';
import { apiData, apiError, newRequestId } from '@/lib/api';
import { getContainer } from '@/lib/container';
import { requireCrmContext } from '@/lib/crm';

/**
 * `POST /api/v1/crm/messages/reply` — reception answering a member in their own words
 * (ADR-127).
 *
 * Every other message the gym sends is written by a rule and approved by Meta as a
 * template. This is the one a person types, and it exists because a member who writes
 * *"maine to kal hi paise diye the"* needs an answer, not another reminder.
 *
 * **It can only be sent inside Meta's 24-hour window.** Outside it, free text is refused
 * by the Graph API — a refusal the member never sees and reception cannot read from an
 * error code. So the window is checked here as well as on the screen: the composer is the
 * courtesy, this is the guard, and `serviceWindow` is the one rule both of them read.
 *
 * **A trainer can read a thread and cannot write to it.** Speaking as the gym is
 * `member.edit`, which reception and the owner have — the same bar as changing the
 * member's record, because to the member on the other end it is the same gym talking.
 *
 * The row is written whatever the provider says. A message that failed is the thing
 * reception most needs to see, and a send with no log is a send nobody can account for.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Long enough for a real answer, short enough that nobody pastes an essay into WhatsApp. */
const MAX_BODY = 1_000;

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const { actor, gym } = await requireCrmContext();
  const container = getContainer();
  const { clock, prisma, whatsapp } = container;
  const now = clock.now();

  if (!can(actor, 'member.edit', now)) {
    return apiError(403, 'FORBIDDEN', 'You cannot send messages', requestId);
  }

  const body = (await request.json().catch(() => null)) as { memberId?: unknown; text?: unknown } | null;
  const memberId = typeof body?.memberId === 'string' ? body.memberId : null;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (memberId === null || text === '' || text.length > MAX_BODY) {
    return apiError(400, 'VALIDATION_FAILED', 'A member and a message are both needed', requestId);
  }

  const member = await prisma.member.findFirst({
    where: { id: memberId, gymId: gym.id, deletedAt: null },
    select: { id: true, mobile: true, language: true, remindersUnsubscribedAt: true },
  });
  if (member === null) return apiError(404, 'NOT_FOUND', 'No such member', requestId);

  /**
   * Somebody who asked the gym to stop is still owed an answer when they write in —
   * stopping the reminders is not asking to be ignored. The opposite would be: a member
   * who said STOP and then asks a question gets silence from the desk.
   */

  const lastInbound = await prisma.messageLog.findFirst({
    where: { gymId: gym.id, memberId: member.id, direction: 'INBOUND' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  const window = serviceWindow(lastInbound?.createdAt ?? null, now);
  if (!window.open) {
    return apiError(409, 'VALIDATION_FAILED', 'WhatsApp only allows a free reply within 24 hours of their message', requestId, {
      details: { reason: 'WINDOW_CLOSED' },
    });
  }

  // One key per staff member per minute per thread: a double-tap on a slow connection
  // must not send twice, while a genuine second message a minute later still goes.
  const minute = now.toISOString().slice(0, 16);
  const idempotencyKey = `crm-reply:${member.id}:${actor.staffUserId}:${minute}`;

  const outcome = await whatsapp.sendText({
    to: member.mobile as E164Mobile,
    body: text,
    idempotencyKey,
    purpose: 'OTHER',
    memberId: member.id,
  });

  await new PrismaMessageLogWriter(prisma).record({
    gymId: gym.id,
    memberId: member.id,
    membershipId: null,
    direction: 'OUTBOUND',
    purpose: 'OTHER',
    ruleCode: null,
    templateName: null,
    language: member.language,
    toNumber: member.mobile as E164Mobile,
    idempotencyKey,
    providerMessageId: outcome.status === 'SENT' ? outcome.providerMessageId : null,
    status: outcome.status,
    bodyPreview: text,
    payload: null,
    businessDate: todayIST(clock),
    ...(outcome.status === 'FAILED' ? { errorCode: outcome.errorCode, errorMessage: outcome.errorMessage } : {}),
  });

  return apiData({ status: outcome.status }, requestId);
}
