import type { Clock } from '@mfp/shared';
import { DomainError } from '../errors';
import type { PaymentProvider, VerifyCheckoutRequest } from '../ports/payments';
import { confirmPayment, type ConfirmPaymentResult, type PaymentConfirmationUnitOfWork } from './confirm-payment';

/**
 * Verifying a browser checkout (api-specification.md `POST /checkout/verify`).
 *
 * The browser's success callback is a hint, not proof. The signature must verify
 * (case P5), and the amount and status come from the provider's own record of the
 * payment — never from the request (BR-11.3). A payment that is authorised but not
 * yet captured is left for the webhook, which is the final word (PAY-03); the page
 * polls `GET /checkout/status` meanwhile.
 */

export type VerifyCheckoutResult =
  | ConfirmPaymentResult
  | { readonly outcome: 'PENDING' | 'FAILED'; readonly paymentId: null };

export async function verifyCheckout(
  request: VerifyCheckoutRequest,
  deps: { provider: PaymentProvider; clock: Clock; uow: PaymentConfirmationUnitOfWork },
): Promise<VerifyCheckoutResult> {
  if (!deps.provider.verifyCheckoutSignature(request)) {
    throw new DomainError('INVALID_PAYMENT_SIGNATURE', 'The checkout signature did not verify');
  }

  const fetched = await deps.provider.fetchPayment(request.providerPaymentId);
  if (fetched.providerOrderId !== request.providerOrderId) {
    throw new DomainError('INVALID_PAYMENT_SIGNATURE', 'That payment does not belong to this order');
  }

  if (fetched.status === 'failed' || fetched.status === 'refunded') {
    return { outcome: 'FAILED', paymentId: null };
  }
  if (fetched.status !== 'captured') {
    return { outcome: 'PENDING', paymentId: null };
  }

  return confirmPayment(
    {
      providerOrderId: request.providerOrderId,
      providerPaymentId: request.providerPaymentId,
      paidAmountPaise: fetched.amountPaise,
      source: deps.provider.name === 'simulated' ? 'simulated' : 'checkout',
    },
    { clock: deps.clock, uow: deps.uow },
  );
}
