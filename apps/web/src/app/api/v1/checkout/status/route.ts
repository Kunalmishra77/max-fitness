import type { NextRequest } from 'next/server';
import { PrismaSignupReader } from '@mfp/db';
import { apiData, apiError, newRequestId } from '@/lib/api';
import { errorResponse } from '@/lib/api-errors';
import { getContainer } from '@/lib/container';
import { paymentStatusView } from '@/lib/payment-status';
import { checkoutLimiters, clientIp, limiterKey } from '@/lib/rate-limit';
import { checkoutAccess } from '@/lib/signup-access';

/**
 * `GET /api/v1/checkout/status?paymentId=` — the polling fallback while a payment is
 * authorised but not yet captured (api-specification.md §3; every 2 s for up to 60 s).
 *
 * Requires the same sign-up or renew token as the order, and answers only for that
 * member's own payment: anyone else's id is simply not found.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAYMENT_ID = /^[a-z0-9]{8,40}$/i;

export async function GET(request: NextRequest) {
  const requestId = newRequestId();

  const ipCheck = checkoutLimiters.statusByIp.hit(limiterKey('checkout-status-ip', clientIp(request.headers)));
  if (!ipCheck.allowed) {
    return apiError(429, 'RATE_LIMITED', 'Too many requests', requestId, {
      details: { retryAfterSeconds: ipCheck.retryAfterSeconds },
      headers: { 'Retry-After': String(ipCheck.retryAfterSeconds) },
    });
  }

  const paymentId = request.nextUrl.searchParams.get('paymentId') ?? '';
  if (!PAYMENT_ID.test(paymentId)) {
    return apiError(400, 'VALIDATION_FAILED', 'paymentId is required', requestId);
  }

  try {
    const { clock, env, prisma } = getContainer();
    const access = checkoutAccess(request.headers, { secret: env.LINK_TOKEN_SECRET, clock });

    const summary = await new PrismaSignupReader(prisma).paymentById(paymentId);
    if (summary?.memberId !== access.memberId) {
      return apiError(404, 'PAYMENT_NOT_FOUND', 'Payment not found', requestId);
    }
    return apiData(paymentStatusView(summary, { secret: env.LINK_TOKEN_SECRET, clock, appUrl: env.APP_URL }), requestId);
  } catch (error) {
    return errorResponse(error, requestId, 'checkout-status');
  }
}
