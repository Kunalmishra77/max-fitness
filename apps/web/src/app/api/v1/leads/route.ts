import type { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { LeadCreateSchema, leadIssueField, normaliseIndianMobile } from '@mfp/shared';
import { detectBot, submitLead } from '@mfp/core';
import { PrismaLeadUnitOfWork } from '@mfp/db';
import { apiData, apiError, newRequestId } from '@/lib/api';
import { getContainer } from '@/lib/container';
import { clientIp, leadLimiters, limiterKey } from '@/lib/rate-limit';

/**
 * `POST /api/v1/leads` — the hero "Get a call back" form (PRD LP-04).
 *
 * Order matters: the IP limit is checked before anything is parsed, so a flood of
 * junk costs almost nothing; validation next; then the bot checks, which return an
 * ordinary-looking success without storing anything; then the per-mobile limit; and
 * only then a database transaction (packages/core `submitLead`).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A lead body is a few hundred bytes; anything larger is not a lead. */
const MAX_BODY_BYTES = 4_096;

let cachedGymId: string | undefined;

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  const ipCheck = leadLimiters.byIp.hit(limiterKey('lead-ip', clientIp(request.headers)));
  if (!ipCheck.allowed) {
    return tooMany(ipCheck.retryAfterSeconds, requestId);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return apiError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large', requestId);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return apiError(400, 'VALIDATION_FAILED', 'Request body must be JSON', requestId);
  }

  const parsed = LeadCreateSchema.safeParse(body);
  if (!parsed.success) {
    // `fields` maps each field to its validation code (`lead.errors.<code>` on the client).
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = leadIssueField(issue.path);
      if (field !== null && fields[field] === undefined) fields[field] = issue.message;
    }
    return apiError(400, 'VALIDATION_FAILED', 'Some fields need attention', requestId, { details: { fields } });
  }

  try {
    const { clock, prisma, env } = getContainer();

    const bot = detectBot({ honeypot: parsed.data.company, renderedAt: parsed.data.renderedAt, now: clock.now() });
    if (bot !== null) {
      // No PII in logs (CLAUDE.md §2.8): the signal and the request id are enough.
      console.warn(`[leads] dropped likely-bot submission (${bot}) ${requestId}`);
      return apiData({ leadId: `lead_${randomBytes(12).toString('hex')}` }, requestId, 201);
    }

    const mobile = normaliseIndianMobile(parsed.data.mobile);
    const mobileCheck = leadLimiters.byMobile.hit(limiterKey('lead-mobile', mobile ?? parsed.data.mobile));
    if (!mobileCheck.allowed) {
      return tooMany(mobileCheck.retryAfterSeconds, requestId);
    }

    cachedGymId ??= (await prisma.gym.findUnique({ where: { slug: env.GYM_SLUG }, select: { id: true } }))?.id;
    if (cachedGymId === undefined) {
      console.error(`[leads] gym "${env.GYM_SLUG}" not found ${requestId}`);
      return apiError(500, 'INTERNAL', 'Something went wrong', requestId);
    }

    const result = await submitLead(parsed.data, {
      gymId: cachedGymId,
      clock,
      uow: new PrismaLeadUnitOfWork(prisma),
    });

    return apiData({ leadId: result.leadId }, requestId, 201);
  } catch (error) {
    // The error class only: a driver message can contain connection details.
    console.error(`[leads] failed ${requestId}: ${error instanceof Error ? error.name : 'Error'}`);
    return apiError(500, 'INTERNAL', 'Something went wrong', requestId);
  }
}

function tooMany(retryAfterSeconds: number, requestId: string) {
  return apiError(429, 'RATE_LIMITED', 'Too many requests', requestId, {
    details: { retryAfterSeconds },
    headers: { 'Retry-After': String(retryAfterSeconds) },
  });
}
