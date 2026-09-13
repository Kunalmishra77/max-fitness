import type { NextRequest } from 'next/server';
import { CheckoutVerifySchema } from '@mfp/shared';
import { verifyCheckout } from '@mfp/core';
import { PrismaSignupReader } from '@mfp/db';
import { apiData, apiError, newRequestId } from '@/lib/api';
import { errorResponse } from '@/lib/api-errors';
import { getContainer } from '@/lib/container';
import { checkoutLimiters, clientIp, limiterKey } from '@/lib/rate-limit';
import { readJsonBody } from '@/lib/request-body';
import { paymentStatusView } from '@/lib/payment-status';

/**
 * `POST /api/v1/checkout/verify` — the browser's "payment succeeded" callback
 * (api-specification.md §3; signup-and-payment-flow.md §5).
 *
 * The signature proves the callback came from this checkout; the amount and status
 * are then read from the gateway's own record, and `verifyCheckout` runs the same
 * idempotent confirmation the webhook does. No token is needed — only the payer holds
 * a valid signature — and the response carries nothing beyond that payment.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  const ipCheck = checkoutLimiters.byIp.hit(limiterKey('checkout-ip', clientIp(request.headers)));
  if (!ipCheck.allowed) {
    return apiError(429, 'RATE_LIMITED', 'Too many requests', requestId, {
      details: { retryAfterSeconds: ipCheck.retryAfterSeconds },
      headers: { 'Retry-After': String(ipCheck.retryAfterSeconds) },
    });
  }

  const body = await readJsonBody(request, 1_024);
  if (!body.ok) {
    return apiError(body.status, body.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_FAILED', 'Invalid request body', requestId);
  }
  const parsed = CheckoutVerifySchema.safeParse(body.value);
  if (!parsed.success) {
    return apiError(400, 'VALIDATION_FAILED', 'Invalid payment callback', requestId);
  }

  try {
    const { clock, env, prisma, payments, paymentUow } = getContainer();
    const result = await verifyCheckout(
      {
        providerOrderId: parsed.data.razorpay_order_id,
        providerPaymentId: parsed.data.razorpay_payment_id,
        signature: parsed.data.razorpay_signature,
      },
      { provider: payments, clock, uow: paymentUow },
    );

    if (result.paymentId === null) {
      return apiData({ status: result.outcome }, requestId);
    }
    if (result.outcome === 'AMOUNT_MISMATCH') {
      // Money arrived but not the amount ordered: held for the gym to check, not activated.
      return apiData({ status: 'NEEDS_REVIEW' }, requestId);
    }

    const summary = await new PrismaSignupReader(prisma).paymentById(result.paymentId);
    if (summary === null) {
      return apiError(404, 'PAYMENT_NOT_FOUND', 'Payment not found', requestId);
    }
    return apiData(paymentStatusView(summary, { secret: env.LINK_TOKEN_SECRET, clock, appUrl: env.APP_URL }), requestId);
  } catch (error) {
    return errorResponse(error, requestId, 'checkout-verify');
  }
}
