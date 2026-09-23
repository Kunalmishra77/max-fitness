import { todayIST, type Clock } from '@mfp/shared';
import { DomainError } from '../errors';
import type { OutboxEventInput } from '../ports/outbox';
import { MEMBER_CODE_COUNTER_KEY, formatMemberCode, formatReceiptNumber, receiptCounterKey } from './receipt-number';

/**
 * Payment confirmation (signup-and-payment-flow.md §5; BR-11; cases P1–P4, P8).
 *
 * The single path by which money becomes a membership. The checkout verify call, the
 * Razorpay webhook and the demo simulator all end here, in one transaction, so
 * whichever arrives first wins and every later arrival is a no-op. The store locks
 * the payment row first; that lock is what makes two concurrent webhooks safe (P3),
 * and what keeps the receipt series gapless (BR-11.2).
 */

export type ConfirmationSource = 'checkout' | 'webhook' | 'simulated';

export type PaymentRecordStatus = 'CREATED' | 'PAID' | 'FAILED' | 'VOIDED' | 'REFUNDED';

export interface PaymentForConfirmation {
  readonly id: string;
  readonly gymId: string;
  readonly memberId: string;
  readonly membershipId: string | null;
  readonly amountPaise: number;
  readonly status: PaymentRecordStatus;
  readonly receiptNo: string | null;
  /** `AMOUNT_MISMATCH` once a delivery has been held for review; otherwise the last failure, if any. */
  readonly failureReason: string | null;
}

/** An entry on the CRM bell (crm-ux-blueprint alerts), written in the same transaction. */
export interface PaymentAlertRecord {
  readonly gymId: string;
  readonly type: 'ONLINE_PAYMENT' | 'SYSTEM';
  readonly memberId: string;
  /** i18n key rendered by the CRM bell. */
  readonly title: string;
  /** Stored as JSON; a number stays a number so the owner's alert can format it. */
  readonly params: Readonly<Record<string, string | number>>;
}

/** Follow-up calls that no longer make sense once the member has paid. */
export const CALL_TASKS_CLOSED_BY_PAYMENT = [
  'SIGNUP_NOT_PAID',
  'EXPIRED_NOT_RENEWED',
  'DUE_SOON_NO_RESPONSE',
  'EXPIRED_BUT_VISITING',
] as const;
export type CallTaskClosedByPayment = (typeof CALL_TASKS_CLOSED_BY_PAYMENT)[number];

export interface PaidUpdate {
  readonly providerPaymentId: string;
  readonly paidAt: Date;
  readonly receiptNo: string;
  /** True only when the browser's checkout signature was verified. */
  readonly signatureOk: boolean;
  readonly method: 'RAZORPAY' | 'SIMULATED';
}

/** Runs inside one transaction; `lockPaymentByOrderId` must take a row lock. */
export interface PaymentConfirmationStore {
  lockPaymentByOrderId(providerOrderId: string): Promise<PaymentForConfirmation | null>;
  /** Increment-and-return on a locked counter row (database-design.md §6). */
  nextCounterValue(gymId: string, key: string): Promise<number>;
  markPaymentPaid(paymentId: string, update: PaidUpdate): Promise<void>;
  flagPayment(paymentId: string, reason: 'AMOUNT_MISMATCH'): Promise<void>;
  confirmMembership(membershipId: string, confirmedAt: Date): Promise<void>;
  getMember(memberId: string): Promise<{ readonly id: string; readonly memberCode: string | null }>;
  activateMember(memberId: string, memberCode: string): Promise<void>;
  closeOpenCallTasks(memberId: string, reasons: readonly CallTaskClosedByPayment[], closedAt: Date): Promise<void>;
  createAlert(alert: PaymentAlertRecord): Promise<void>;
  enqueueOutbox(event: OutboxEventInput): Promise<void>;
}

export interface PaymentConfirmationUnitOfWork {
  transaction<T>(work: (store: PaymentConfirmationStore) => Promise<T>): Promise<T>;
}

export interface ConfirmPaymentInput {
  readonly providerOrderId: string;
  readonly providerPaymentId: string;
  /** From the provider's own record of the payment, never from the browser (BR-11.3). */
  readonly paidAmountPaise: number;
  readonly source: ConfirmationSource;
}

export type ConfirmPaymentResult =
  | {
      readonly outcome: 'CONFIRMED' | 'ALREADY_CONFIRMED';
      readonly paymentId: string;
      readonly memberId: string;
      readonly membershipId: string | null;
      readonly receiptNo: string | null;
      readonly memberCode: string | null;
    }
  | { readonly outcome: 'AMOUNT_MISMATCH'; readonly paymentId: string; readonly memberId: string };

function paymentEvents(payment: PaymentForConfirmation): OutboxEventInput[] {
  const { id, gymId, memberId } = payment;
  return [
    { type: 'whatsapp.receipt', gymId, payload: { paymentId: id }, dedupeKey: `receipt:${id}` },
    { type: 'receipt.pdf', gymId, payload: { paymentId: id }, dedupeKey: `pdf:${id}` },
    // The dispatcher checks face consent and minor status before creating a job.
    { type: 'kiosk.enroll', gymId, payload: { memberId }, dedupeKey: `enroll:${memberId}` },
  ];
}

export function confirmPayment(
  input: ConfirmPaymentInput,
  deps: { clock: Clock; uow: PaymentConfirmationUnitOfWork },
): Promise<ConfirmPaymentResult> {
  return deps.uow.transaction(async (store) => {
    const payment = await store.lockPaymentByOrderId(input.providerOrderId);
    if (payment === null) {
      throw new DomainError('PAYMENT_NOT_FOUND', 'No payment exists for that order');
    }

    if (payment.status === 'PAID') {
      const member = await store.getMember(payment.memberId);
      return {
        outcome: 'ALREADY_CONFIRMED',
        paymentId: payment.id,
        memberId: payment.memberId,
        membershipId: payment.membershipId,
        receiptNo: payment.receiptNo,
        memberCode: member.memberCode,
      };
    }
    if (payment.status === 'VOIDED' || payment.status === 'REFUNDED') {
      throw new DomainError('PAYMENT_ALREADY_SETTLED', 'This payment was voided or refunded', { paymentId: payment.id });
    }

    // Case P4: a captured amount that differs from the order is never activated.
    if (input.paidAmountPaise !== payment.amountPaise) {
      // A second delivery of the same mismatch (order.paid after payment.captured) changes nothing.
      if (payment.failureReason === 'AMOUNT_MISMATCH') {
        return { outcome: 'AMOUNT_MISMATCH', paymentId: payment.id, memberId: payment.memberId };
      }
      await store.flagPayment(payment.id, 'AMOUNT_MISMATCH');
      await store.createAlert({
        gymId: payment.gymId,
        type: 'SYSTEM',
        memberId: payment.memberId,
        title: 'crm.alerts.paymentAmountMismatch',
        // Both numbers, so the owner's alert can say what was asked and what came.
        params: { paymentId: payment.id, receivedPaise: input.paidAmountPaise },
      });
      return { outcome: 'AMOUNT_MISMATCH', paymentId: payment.id, memberId: payment.memberId };
    }

    const now = deps.clock.now();
    const today = todayIST(deps.clock);
    const receiptNo = formatReceiptNumber(today, await store.nextCounterValue(payment.gymId, receiptCounterKey(today)));

    await store.markPaymentPaid(payment.id, {
      providerPaymentId: input.providerPaymentId,
      paidAt: now,
      receiptNo,
      signatureOk: input.source === 'checkout',
      method: input.source === 'simulated' ? 'SIMULATED' : 'RAZORPAY',
    });
    if (payment.membershipId !== null) {
      await store.confirmMembership(payment.membershipId, now);
    }

    const member = await store.getMember(payment.memberId);
    const memberCode =
      member.memberCode ?? formatMemberCode(await store.nextCounterValue(payment.gymId, MEMBER_CODE_COUNTER_KEY));
    await store.activateMember(payment.memberId, memberCode);
    await store.closeOpenCallTasks(payment.memberId, CALL_TASKS_CLOSED_BY_PAYMENT, now);
    await store.createAlert({
      gymId: payment.gymId,
      type: 'ONLINE_PAYMENT',
      memberId: payment.memberId,
      title: 'crm.alerts.onlinePayment',
      params: { paymentId: payment.id, receiptNo },
    });

    for (const event of paymentEvents(payment)) {
      await store.enqueueOutbox(event);
    }

    return {
      outcome: 'CONFIRMED',
      paymentId: payment.id,
      memberId: payment.memberId,
      membershipId: payment.membershipId,
      receiptNo,
      memberCode,
    };
  });
}
