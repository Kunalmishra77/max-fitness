import type { Clock } from '@mfp/shared';
import { DomainError, isDomainError } from '../errors';
import { mandateStatusFrom, type MandateStatus } from '../mandates/mandate';
import type { MandateChargeInput, MandateChargeResult } from '../mandates/record-mandate-charge';
import type { MandateStatusInput, MandateStatusResult } from '../mandates/update-mandate-status';
import type { PaymentProvider, SubscriptionStatus } from '../ports/payments';
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
  | 'FAILED_RECORDED'
  // Autopay (ADR-105).
  | 'MANDATE_RENEWED'
  | 'MANDATE_UPDATED';

/**
 * The two mandate operations, injected rather than imported, so this stays a dispatcher.
 *
 * Optional on purpose: `DEMO_MODE` has no subscription provider, so a `subscription.*` event
 * cannot be acted on there. Without these the family falls through to `IGNORED`, which
 * answers 200 and archives the payload — inventing a mandate would be worse than ignoring it.
 */
export interface MandateWebhookHandlers {
  recordCharge(input: MandateChargeInput): Promise<MandateChargeResult>;
  updateStatus(input: MandateStatusInput): Promise<MandateStatusResult>;
}

interface PaymentEntity {
  readonly id: string;
  readonly orderId: string | null;
  readonly amountPaise: number;
  readonly errorDescription: string | null;
}

interface SubscriptionEntity {
  readonly id: string;
  readonly status: MandateStatus | null;
  /** Razorpay's next-charge instant, from Unix seconds. */
  readonly chargeAt: Date | null;
}

const SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set<SubscriptionStatus>([
  'created',
  'authenticated',
  'active',
  'pending',
  'halted',
  'paused',
  'cancelled',
  'completed',
  'expired',
]);

/**
 * `subscription.resumed` has no state of its own — Razorpay reports the subscription as
 * `active` in the entity — but the event name is the only thing some deliveries carry, so
 * the names that imply a state are mapped too.
 */
const STATUS_BY_EVENT: Readonly<Record<string, MandateStatus>> = {
  'subscription.authenticated': 'AUTHENTICATED',
  'subscription.activated': 'ACTIVE',
  'subscription.resumed': 'ACTIVE',
  'subscription.charged': 'ACTIVE',
  'subscription.pending': 'PENDING',
  'subscription.halted': 'HALTED',
  'subscription.paused': 'PAUSED',
  'subscription.cancelled': 'CANCELLED',
  'subscription.completed': 'COMPLETED',
  'subscription.expired': 'EXPIRED',
};

function parseEvent(rawBody: string): {
  event: string;
  payload: unknown;
  payment: PaymentEntity | null;
  subscription: SubscriptionEntity | null;
} {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new DomainError('VALIDATION_FAILED', 'Webhook body is not JSON');
  }
  const root = payload as {
    event?: unknown;
    payload?: {
      payment?: { entity?: Record<string, unknown> };
      subscription?: { entity?: Record<string, unknown> };
    };
  };
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

  const sub = root.payload?.subscription?.entity;
  const rawStatus = sub?.['status'];
  const chargeAt = sub?.['charge_at'];
  const subscription =
    sub !== undefined && typeof sub['id'] === 'string'
      ? {
          id: sub['id'],
          // The entity's own status wins; the event name is the fallback, because the two
          // disagree only when a delivery is partial.
          status:
            typeof rawStatus === 'string' && SUBSCRIPTION_STATUSES.has(rawStatus)
              ? mandateStatusFrom(rawStatus as SubscriptionStatus)
              : (STATUS_BY_EVENT[root.event] ?? null),
          chargeAt: typeof chargeAt === 'number' && Number.isFinite(chargeAt) ? new Date(chargeAt * 1000) : null,
        }
      : null;

  return { event: root.event, payload, payment, subscription };
}

export async function handleRazorpayWebhook(
  input: { rawBody: string; signature: string; eventId: string | null },
  deps: {
    provider: PaymentProvider;
    clock: Clock;
    uow: PaymentConfirmationUnitOfWork;
    events: WebhookEventStore;
    mandates?: MandateWebhookHandlers;
  },
): Promise<{ outcome: WebhookOutcome }> {
  if (!deps.provider.verifyWebhookSignature(input.rawBody, input.signature)) {
    throw new DomainError('INVALID_PAYMENT_SIGNATURE', 'The webhook signature did not verify');
  }

  const { event, payload, payment, subscription } = parseEvent(input.rawBody);
  const externalId = input.eventId ?? `${event}:${payment?.id ?? subscription?.id ?? 'no-payment'}`;

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

    // Autopay (ADR-105). A charge is money already taken; everything else is state.
    if (event.startsWith('subscription.') && subscription !== null && deps.mandates !== undefined) {
      if (event === 'subscription.charged') {
        // Without a payment entity there is nothing to record and no id to be idempotent on.
        // Guessing one would risk a second receipt for the same debit.
        if (payment !== null) {
          await deps.mandates.recordCharge({
            providerSubscriptionId: subscription.id,
            providerPaymentId: payment.id,
            paidAmountPaise: payment.amountPaise,
            nextChargeAt: subscription.chargeAt,
          });
          await deps.events.markProcessed(externalId, null);
          return { outcome: 'MANDATE_RENEWED' };
        }
      } else if (subscription.status !== null) {
        await deps.mandates.updateStatus({
          providerSubscriptionId: subscription.id,
          status: subscription.status,
          nextChargeAt: subscription.chargeAt,
          // Razorpay puts no reason on the subscription entity. When a halt arrives alongside
          // the payment that caused it, that is where the reason is.
          failureReason: payment?.errorDescription ?? null,
        });
        await deps.events.markProcessed(externalId, null);
        return { outcome: 'MANDATE_UPDATED' };
      }
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
