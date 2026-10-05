import type { NextRequest } from 'next/server';
import { startMandate } from '@mfp/core';
import { apiData, apiError, newRequestId } from '@/lib/api';
import { errorResponse } from '@/lib/api-errors';
import { getContainer } from '@/lib/container';
import { checkoutLimiters, clientIp, limiterKey } from '@/lib/rate-limit';
import { checkoutAccess } from '@/lib/signup-access';

/**
 * `POST /api/v1/checkout/autopay` — the member setting their own fee to pay itself
 * (ADR-105).
 *
 * Authorised by the same sign-up or renew token as the order and the status poll, so it can
 * only ever act on the member that token names. Nothing is taken: the reply is a link the
 * member has to open and authorise in their own UPI app or with their own bank, and until
 * they do the mandate is `CREATED` and the gym keeps chasing the fee as usual.
 *
 * No amount or date is accepted from the client. Which plan, how much and when the first
 * debit lands are all decided from the register — the member has just paid for a term, and
 * the mandate starts the day after it ends.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  // The same limiter family as the rest of checkout: this creates something at Razorpay,
  // so it must not be callable in a loop.
  const ipCheck = checkoutLimiters.statusByIp.hit(limiterKey('checkout-autopay-ip', clientIp(request.headers)));
  if (!ipCheck.allowed) {
    return apiError(429, 'RATE_LIMITED', 'Too many requests', requestId, {
      details: { retryAfterSeconds: ipCheck.retryAfterSeconds },
      headers: { 'Retry-After': String(ipCheck.retryAfterSeconds) },
    });
  }

  try {
    const { clock, env, subscriptions, startMandateUow, prisma } = getContainer();
    const access = checkoutAccess(request.headers, { secret: env.LINK_TOKEN_SECRET, clock });

    // DEMO_MODE has no gateway to make a real mandate with, and a simulated one that behaved
    // like the real thing would be a fiction the member could not tell apart.
    if (subscriptions === null) {
      return apiError(503, 'AUTOPAY_UNAVAILABLE', 'Automatic payment is not available', requestId);
    }

    const member = await prisma.member.findFirst({
      where: { id: access.memberId, deletedAt: null },
      select: { gymId: true },
    });
    if (member === null) {
      return apiError(404, 'MEMBER_NOT_FOUND', 'Member not found', requestId);
    }

    const result = await startMandate(
      // The member is doing this for themselves, and is looking at the link on screen a
      // moment later, so the WhatsApp copy of it would arrive as a duplicate. The CRM path
      // is the one that notifies.
      { memberId: access.memberId, gymId: member.gymId, notify: false },
      { clock, provider: subscriptions, uow: startMandateUow },
    );

    return apiData(
      {
        status: result.status,
        authoriseUrl: result.shortUrl,
        firstChargeOn: result.firstChargeOn,
        alreadySetUp: result.outcome === 'ALREADY_LIVE',
      },
      requestId,
    );
  } catch (error) {
    return errorResponse(error, requestId, 'checkout-autopay');
  }
}
