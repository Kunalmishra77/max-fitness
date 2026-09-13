import type { NextRequest } from 'next/server';
import { SimulateCheckoutSchema } from '@mfp/shared';
import { PrismaSignupReader } from '@mfp/db';
import { apiData, apiError, newRequestId } from '@/lib/api';
import { errorResponse } from '@/lib/api-errors';
import { getContainer } from '@/lib/container';
import { readJsonBody } from '@/lib/request-body';
import { checkoutAccess } from '@/lib/signup-access';

/**
 * `POST /api/v1/checkout/simulate` — the DEMO_MODE pay dialog (CLAUDE.md §2.7;
 * signup-and-payment-flow.md §8).
 *
 * Stands in for Razorpay's checkout window: it completes the simulated order and hands
 * back exactly what Razorpay's success handler would, which the browser then posts to
 * `/checkout/verify` like a real payment — so the demo exercises the real verify and
 * confirmation path. Does not exist when DEMO_MODE is off.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const container = getContainer();
  const { simulator, clock, env, prisma, webhookEvents } = container;
  if (simulator === null) {
    return apiError(404, 'NOT_FOUND', 'Not found', requestId);
  }

  const body = await readJsonBody(request, 1_024);
  const parsed = body.ok ? SimulateCheckoutSchema.safeParse(body.value) : null;
  if (parsed === null || !parsed.success) {
    return apiError(400, 'VALIDATION_FAILED', 'Invalid request body', requestId);
  }

  try {
    const access = checkoutAccess(request.headers, { secret: env.LINK_TOKEN_SECRET, clock });
    const summary = await new PrismaSignupReader(prisma).paymentByOrderId(parsed.data.providerOrderId);
    if (summary?.memberId !== access.memberId) {
      return apiError(404, 'PAYMENT_NOT_FOUND', 'Payment not found', requestId);
    }

    let completed: ReturnType<typeof simulator.completeCheckout>;
    try {
      completed = simulator.completeCheckout(parsed.data.providerOrderId, { outcome: parsed.data.outcome });
    } catch {
      // The simulator keeps orders in memory; a server restart forgets them. Start again.
      return apiError(409, 'CONFLICT', 'This demo order has expired; start the payment again', requestId);
    }

    if (parsed.data.outcome === 'failure') {
      // What Razorpay's payment.failed webhook would record.
      await webhookEvents.markPaymentFailed(parsed.data.providerOrderId, 'Simulated failure');
    }

    return apiData(
      {
        razorpay_order_id: completed.providerOrderId,
        razorpay_payment_id: completed.providerPaymentId,
        razorpay_signature: completed.signature,
      },
      requestId,
    );
  } catch (error) {
    return errorResponse(error, requestId, 'checkout-simulate');
  }
}
