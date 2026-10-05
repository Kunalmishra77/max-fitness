import { toISTDate, todayIST, type Clock, type ISTDate } from '@mfp/shared';
import type { OutboxEventInput } from '../ports/outbox';
import { membershipEndDate, renewalStartDate } from '../membership/dates';
import { CALL_TASKS_CLOSED_BY_PAYMENT, type CallTaskClosedByPayment } from '../payments/confirm-payment';
import { MEMBER_CODE_COUNTER_KEY, formatMemberCode, formatReceiptNumber, receiptCounterKey } from '../payments/receipt-number';
import type { MandateStatus } from './mandate';

/**
 * An autopay debit becoming a membership (ADR-105 §4).
 *
 * Razorpay's `subscription.charged` says money has already left the member's account. By the
 * time this runs the decision has been made elsewhere and the only question is whether the
 * register ends up agreeing with the bank — so almost nothing here refuses. The two cases
 * that look like they should refuse, an unexpected amount and a mandate the desk cancelled,
 * record the money and raise an alert instead, because a member who has been debited and
 * shows as unpaid is a worse outcome than a number somebody has to look at.
 *
 * It cannot reuse `confirmPayment()`. That finds its payment by the order **we** created at
 * checkout; an autopay debit's order is one Razorpay made on its own schedule and we never
 * saw. The effects are deliberately the same ones, in the same order.
 */

export interface MandateForCharge {
  readonly id: string;
  readonly gymId: string;
  readonly memberId: string;
  readonly planId: string;
  /** What the mandate was set up to take, frozen at creation. */
  readonly amountPaise: number;
  readonly intervalMonths: number;
  readonly status: MandateStatus;
}

export interface MandateMembershipInput {
  readonly gymId: string;
  readonly memberId: string;
  readonly planId: string;
  readonly durationMonths: number;
  readonly startDate: ISTDate;
  readonly endDate: ISTDate;
  readonly pricePaise: number;
  readonly status: 'CONFIRMED';
  readonly source: 'WEBSITE';
  readonly confirmedAt: Date;
}

export interface MandatePaymentInput {
  readonly gymId: string;
  readonly memberId: string;
  readonly membershipId: string;
  readonly mandateId: string;
  readonly amountPaise: number;
  readonly method: 'RAZORPAY';
  readonly status: 'PAID';
  readonly receiptNo: string;
  readonly providerPaymentId: string;
  /**
   * True: the webhook's HMAC was verified over the raw bytes before this ran, and it is the
   * only signature an autopay debit has — a stronger one than a browser checkout's.
   */
  readonly providerSignatureOk: true;
  readonly paidAt: Date;
}

export interface MandateChargedUpdate {
  readonly status: MandateStatus;
  readonly lastChargedAt: Date;
  /** Razorpay's own next-charge date, or `null` when the event did not carry one. */
  readonly nextChargeOn: ISTDate | null;
  readonly incrementChargeCount: true;
  readonly clearFailureReason: true;
}

/** An entry on the CRM bell, written in the same transaction. */
export interface MandateAlertRecord {
  readonly gymId: string;
  readonly type: 'ONLINE_PAYMENT' | 'SYSTEM';
  readonly memberId: string;
  readonly title: string;
  readonly params: Readonly<Record<string, string | number>>;
}

/** Runs inside one transaction; `lockMandateBySubscriptionId` must take a row lock. */
export interface MandateChargeStore {
  lockMandateBySubscriptionId(providerSubscriptionId: string): Promise<MandateForCharge | null>;
  /** The idempotency check. `Payment.providerPaymentId` is unique in the database. */
  findPaymentByProviderPaymentId(providerPaymentId: string): Promise<{ readonly id: string; readonly receiptNo: string | null } | null>;
  gymSettings(gymId: string): Promise<{ readonly renewalGraceDays: number }>;
  /** Increment-and-return on a locked counter row (database-design.md §6). */
  nextCounterValue(gymId: string, key: string): Promise<number>;
  /** The furthest date the member's cover currently runs to, or `null` for none. */
  latestMembershipEndDate(memberId: string): Promise<ISTDate | null>;
  createMembership(input: MandateMembershipInput): Promise<{ readonly id: string }>;
  createMandatePayment(input: MandatePaymentInput): Promise<{ readonly id: string }>;
  markMandateCharged(mandateId: string, update: MandateChargedUpdate): Promise<void>;
  getMember(memberId: string): Promise<{ readonly id: string; readonly memberCode: string | null }>;
  activateMember(memberId: string, memberCode: string): Promise<void>;
  closeOpenCallTasks(memberId: string, reasons: readonly CallTaskClosedByPayment[], closedAt: Date): Promise<void>;
  createAlert(alert: MandateAlertRecord): Promise<void>;
  enqueueOutbox(event: OutboxEventInput): Promise<void>;
}

export interface MandateChargeUnitOfWork {
  transaction<T>(work: (store: MandateChargeStore) => Promise<T>): Promise<T>;
}

export interface MandateChargeInput {
  readonly providerSubscriptionId: string;
  readonly providerPaymentId: string;
  /** From the provider's own event, never from a browser. */
  readonly paidAmountPaise: number;
  /** When the provider says it will debit next, if the event said. */
  readonly nextChargeAt: Date | null;
}

export type MandateChargeResult =
  | {
      readonly outcome: 'RENEWED';
      readonly paymentId: string;
      readonly membershipId: string;
      readonly receiptNo: string;
      readonly memberCode: string;
    }
  | { readonly outcome: 'ALREADY_RECORDED'; readonly paymentId: string; readonly receiptNo: string | null }
  | { readonly outcome: 'UNKNOWN_MANDATE' };

export function recordMandateCharge(
  input: MandateChargeInput,
  deps: { clock: Clock; uow: MandateChargeUnitOfWork },
): Promise<MandateChargeResult> {
  return deps.uow.transaction(async (store) => {
    const mandate = await store.lockMandateBySubscriptionId(input.providerSubscriptionId);
    if (mandate === null) {
      // Another integration on the same Razorpay account. Not an error, and not worth a retry.
      return { outcome: 'UNKNOWN_MANDATE' };
    }

    // Idempotency. `Payment.providerPaymentId` is unique, so a re-delivery finds the first one.
    const already = await store.findPaymentByProviderPaymentId(input.providerPaymentId);
    if (already !== null) {
      return { outcome: 'ALREADY_RECORDED', paymentId: already.id, receiptNo: already.receiptNo };
    }

    const now = deps.clock.now();
    const today = todayIST(deps.clock);
    const { renewalGraceDays } = await store.gymSettings(mandate.gymId);

    // The money that actually arrived, not the money we expected. The two differ only in
    // anomalies, and in those the bank is right and we are not.
    const amountPaise = input.paidAmountPaise;

    const startDate = renewalStartDate({
      currentEndDate: await store.latestMembershipEndDate(mandate.memberId),
      paymentDate: today,
      renewalGraceDays,
    });
    const membership = await store.createMembership({
      gymId: mandate.gymId,
      memberId: mandate.memberId,
      planId: mandate.planId,
      durationMonths: mandate.intervalMonths,
      startDate,
      endDate: membershipEndDate(startDate, mandate.intervalMonths),
      pricePaise: amountPaise,
      status: 'CONFIRMED',
      source: 'WEBSITE',
      confirmedAt: now,
    });

    const receiptNo = formatReceiptNumber(today, await store.nextCounterValue(mandate.gymId, receiptCounterKey(today)));
    const payment = await store.createMandatePayment({
      gymId: mandate.gymId,
      memberId: mandate.memberId,
      membershipId: membership.id,
      mandateId: mandate.id,
      amountPaise,
      method: 'RAZORPAY',
      status: 'PAID',
      receiptNo,
      providerPaymentId: input.providerPaymentId,
      providerSignatureOk: true,
      paidAt: now,
    });

    await store.markMandateCharged(mandate.id, {
      status: 'ACTIVE',
      lastChargedAt: now,
      nextChargeOn: input.nextChargeAt === null ? null : toISTDate(input.nextChargeAt),
      incrementChargeCount: true,
      clearFailureReason: true,
    });

    const member = await store.getMember(mandate.memberId);
    const memberCode =
      member.memberCode ?? formatMemberCode(await store.nextCounterValue(mandate.gymId, MEMBER_CODE_COUNTER_KEY));
    await store.activateMember(mandate.memberId, memberCode);
    await store.closeOpenCallTasks(mandate.memberId, CALL_TASKS_CLOSED_BY_PAYMENT, now);

    await store.createAlert({
      gymId: mandate.gymId,
      type: 'ONLINE_PAYMENT',
      memberId: mandate.memberId,
      title: 'crm.alerts.autopayCharged',
      params: { paymentId: payment.id, receiptNo, amountPaise },
    });

    // Both anomalies are recorded rather than refused, and both are raised so somebody looks.
    if (amountPaise !== mandate.amountPaise) {
      await store.createAlert({
        gymId: mandate.gymId,
        type: 'SYSTEM',
        memberId: mandate.memberId,
        title: 'crm.alerts.autopayAmountUnexpected',
        params: { paymentId: payment.id, expectedPaise: mandate.amountPaise, receivedPaise: amountPaise },
      });
    }
    if (mandate.status === 'CANCELLED' || mandate.status === 'EXPIRED' || mandate.status === 'COMPLETED') {
      await store.createAlert({
        gymId: mandate.gymId,
        type: 'SYSTEM',
        memberId: mandate.memberId,
        title: 'crm.alerts.autopayAfterCancel',
        params: { paymentId: payment.id, mandateStatus: mandate.status },
      });
    }

    // The same two jobs a counter payment raises, keyed on the payment so a re-delivered
    // webhook cannot send a second receipt.
    await store.enqueueOutbox({
      type: 'whatsapp.receipt',
      gymId: mandate.gymId,
      payload: { paymentId: payment.id },
      dedupeKey: `receipt:${payment.id}`,
    });
    await store.enqueueOutbox({
      type: 'receipt.pdf',
      gymId: mandate.gymId,
      payload: { paymentId: payment.id },
      dedupeKey: `pdf:${payment.id}`,
    });

    return { outcome: 'RENEWED', paymentId: payment.id, membershipId: membership.id, receiptNo, memberCode };
  });
}
