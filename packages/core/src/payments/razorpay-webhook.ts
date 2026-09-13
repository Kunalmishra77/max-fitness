import type { Clock } from '@mfp/shared';
import { DomainError, isDomainError } from '../errors';
import type { PaymentProvider } from '../ports/payments';
import { confirmPayment, type PaymentConfirmationUnitOfWork } from './confirm-payment';

/**
 * Razorpay webhooks (api-specification.md §4; TRD §7; PAY-03).
 *
 * The webhook is the source of truth for a payment. The signature is checked over the
 * raw bytes before anything is parsed or stored; each event is recorded once, so a
 * re-delivery is recognised; and a capture goes through the same `confirmPayment()`
 * as the checkout verify call, so whichever arrives first wins (P1, P2).
 */

export interface WebhookEventRecord {
  readonly provider: 'razorpay';
  /** The `X-Razorpay-Event-Id` header, or a stable fallback built from the event. */
  readonly externalId: string;
  readonly eventType: string;
  readonly signatureOk: boolean;
  readonly payload: unknown;
}

export interface WebhookEventStore {
  /**
   * `DUPLICATE` only when the same event was already processed. An event recorded but
   * never finished (the process died, or processing threw) returns `NEW`, so
   * Razorpay's retry gets another chance instead of being swallowed.
   */
  recordEvent(record: WebhookEventRecord): Promise<'NEW' | 'DUPLICATE'>;
  markProcessed(externalId: string, error: string | null): Promise<void>;
  /** Sets the payment `FAILED` with the reason, unless it has already been paid. */
  markPaymentFailed(providerOrderId: string, reason: string | null): Promise<void>;
}

export type WebhookOutcome =
  | 'DUPLICATE'
  | 'IGNORED'
  | 'CONFIRMED'
  | 'ALREADY_CONFIRMED'
  | 'AMOUNT_MISMATCH'
  | 'FAILED_RECORDED';

interface PaymentEntity {
  readonly id: string;
  readonly orderId: string | null;
  readonly amountPaise: number;
  readonly errorDescription: string | null;
}

function parseEvent(rawBody: string): { event: string; payload: unknown; payment: PaymentEntity | null } {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new DomainError('VALIDATION_FAILED', 'Webhook body is not JSON');
  }
  const root = payload as { event?: unknown; payload?: { payment?: { entity?: Record<string, unknown> } } };
  if (typeof root.event !== 'string') {
    throw new DomainError('VALIDATION_FAILED', 'Webhook body has no event');
  }

  const entity = root.payload?.payment?.entity;
  const payment =
    entity !== undefined && typeof entity['id'] === 'string' && typeof entity['amount'] === 'number'
      ? {
          id: entity['id'],
          orderId: typeof entity['order_id'] === 'string' ? entity['order_id'] : null,
          amountPaise: entity['amount'],
          errorDescription: typeof entity['error_description'] === 'string' ? entity['error_description'] : null,
        }
      : null;

  return { event: root.event, payload, payment };
}

export async function handleRazorpayWebhook(
  input: { rawBody: string; signature: string; eventId: string | null },
  deps: { provider: PaymentProvider; clock: Clock; uow: PaymentConfirmationUnitOfWork; events: WebhookEventStore },
): Promise<{ outcome: WebhookOutcome }> {
  if (!deps.provider.verifyWebhookSignature(input.rawBody, input.signature)) {
    throw new DomainError('INVALID_PAYMENT_SIGNATURE', 'The webhook signature did not verify');
  }

  const { event, payload, payment } = parseEvent(input.rawBody);
  const externalId = input.eventId ?? `${event}:${payment?.id ?? 'no-payment'}`;

  const recorded = await deps.events.recordEvent({ provider: 'razorpay', externalId, eventType: event, signatureOk: true, payload });
  if (recorded === 'DUPLICATE') {
    return { outcome: 'DUPLICATE' };
  }

  try {
    if ((event === 'payment.captured' || event === 'order.paid') && payment?.orderId) {
      const result = await confirmPayment(
        { providerOrderId: payment.orderId, providerPaymentId: payment.id, paidAmountPaise: payment.amountPaise, source: 'webhook' },
        { clock: deps.clock, uow: deps.uow },
      );
      await deps.events.markProcessed(externalId, null);
      return { outcome: result.outcome };
    }

    if (event === 'payment.failed' && payment?.orderId) {
      await deps.events.markPaymentFailed(payment.orderId, payment.errorDescription);
      await deps.events.markProcessed(externalId, null);
      return { outcome: 'FAILED_RECORDED' };
    }

    await deps.events.markProcessed(externalId, null);
    return { outcome: 'IGNORED' };
  } catch (error) {
    // A payment for an order this system never created (another integration on the
    // same Razorpay account) is not an error worth a retry.
    if (isDomainError(error) && error.code === 'PAYMENT_NOT_FOUND') {
      await deps.events.markProcessed(externalId, 'PAYMENT_NOT_FOUND');
      return { outcome: 'IGNORED' };
    }
    // Left unprocessed on purpose, so the retry is accepted (see WebhookEventStore).
    throw error;
  }
}
