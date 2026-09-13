import type { NextRequest } from 'next/server';
import { CheckoutOrderSchema } from '@mfp/shared';
import { createCheckoutOrder } from '@mfp/core';
import { apiData, apiError, newRequestId } from '@/lib/api';
import { errorResponse } from '@/lib/api-errors';
import { getContainer } from '@/lib/container';
import { checkoutSettingsOf, loadGym } from '@/lib/gym';
import { checkoutLimiters, clientIp, limiterKey } from '@/lib/rate-limit';
import { readJsonBody } from '@/lib/request-body';
import { checkoutAccess } from '@/lib/signup-access';

/**
 * `POST /api/v1/checkout/orders` — reserve a plan and open a payment
 * (api-specification.md §3; signup-and-payment-flow.md §4, §6).
 *
 * Authorised by a registration token (sign-up) or a renew token (renewal). The body
 * names a plan and a start date only; `createCheckoutOrder` prices it from the plan
 * row and the gym's settings (BR-11.3).
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

  const body = await readJsonBody(request, 2_048);
  if (!body.ok) {
    return body.status === 413
      ? apiError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large', requestId)
      : apiError(400, 'VALIDATION_FAILED', 'Request body must be JSON', requestId);
  }
  const parsed = CheckoutOrderSchema.safeParse(body.value);
  if (!parsed.success) {
    return apiError(400, 'VALIDATION_FAILED', 'Some fields need attention', requestId);
  }

  try {
    const container = getContainer();
    const { clock, env, payments, checkoutUow } = container;
    const access = checkoutAccess(request.headers, { secret: env.LINK_TOKEN_SECRET, clock });
    const gym = await loadGym(container);

    const result = await createCheckoutOrder(
      {
        memberId: access.memberId,
        planId: parsed.data.planId,
        // A renewal's start follows BR-3.4 from the member's record, whatever was sent.
        startDate: access.mode === 'renewal' ? null : parsed.data.startDate,
        payAtReception: parsed.data.payAtReception,
        mode: access.mode,
      },
      { clock, uow: checkoutUow, provider: payments, settings: checkoutSettingsOf(gym.settings) },
    );

    if (result.kind === 'PAY_AT_RECEPTION') {
      return apiData(
        {
          kind: result.kind,
          paymentId: null,
          amountPaise: result.amountPaise,
          currency: 'INR',
          reservedUntil: result.reservedUntil.toISOString(),
          membership: { startDate: result.membership.startDate, endDate: result.membership.endDate },
        },
        requestId,
        201,
      );
    }

    return apiData(
      {
        kind: result.kind,
        paymentId: result.paymentId,
        provider: result.provider,
        orderId: result.providerOrderId,
        keyId: result.publicKeyId,
        amountPaise: result.amountPaise,
        currency: 'INR',
        prefill: result.prefill,
        membership: { startDate: result.membership.startDate, endDate: result.membership.endDate },
      },
      requestId,
      201,
    );
  } catch (error) {
    return errorResponse(error, requestId, 'checkout-orders');
  }
}
