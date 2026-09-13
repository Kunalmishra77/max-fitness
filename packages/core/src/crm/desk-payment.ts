import { todayIST, type Clock, type ISTDate, type PlanDurationMonths } from '@mfp/shared';
import { planForMember, prepareRenewalCheckout, prepareSignupCheckout, type CheckoutSettings } from '../checkout/checkout.rules';
import type { MemberForCheckout } from '../checkout/checkout.service';
import { DomainError } from '../errors';
import { CALL_TASKS_CLOSED_BY_PAYMENT } from '../payments/confirm-payment';
import { MEMBER_CODE_COUNTER_KEY, formatMemberCode, formatReceiptNumber, receiptCounterKey } from '../payments/receipt-number';
import type { OutboxEventInput } from '../ports/outbox';
import type { Plan } from '../pricing/plans';
import { assertCan, type CrmActor } from './permissions';

/**
 * Taking fees at the desk (crm-ux-blueprint §6 "3 taps"; BR-2, BR-3, BR-11).
 *
 * Cash, UPI or card handed over at reception. The money is already in the drawer, so
 * there is no pending state: the membership is confirmed and the payment recorded as
 * paid in one transaction, with a receipt number from the same per-year counter online
 * payments use — the two series are one series.
 *
 * A discount is the one thing staff can change about the price, and only with the
 * owner's permission, a reason, and never below zero.
 */

export type DeskPaymentMethod = 'CASH' | 'UPI_DIRECT' | 'CARD_POS' | 'BANK_TRANSFER';

export interface DeskMembershipRecord {
  readonly gymId: string;
  readonly memberId: string;
  readonly planId: string;
  readonly durationMonths: PlanDurationMonths;
  readonly startDate: ISTDate;
  readonly endDate: ISTDate;
  readonly pricePaise: number;
  readonly admissionPaise: number;
  readonly discountPaise: number;
  readonly discountReason: string | null;
  readonly source: 'CRM';
  readonly createdById: string;
  readonly confirmedAt: Date;
}

export interface DeskPaymentRecord {
  readonly gymId: string;
  readonly memberId: string;
  readonly membershipId: string;
  readonly amountPaise: number;
  readonly method: DeskPaymentMethod;
  readonly receiptNo: string;
  readonly paidAt: Date;
  readonly recordedById: string;
}

export interface DeskPaymentStore {
  getMemberForDesk(memberId: string): Promise<MemberForCheckout | null>;
  getPlans(gymId: string): Promise<readonly Plan[]>;
  nextCounterValue(gymId: string, key: string): Promise<number>;
  createConfirmedMembership(record: DeskMembershipRecord): Promise<string>;
  createPaidPayment(record: DeskPaymentRecord): Promise<string>;
  getMember(memberId: string): Promise<{ readonly id: string; readonly memberCode: string | null }>;
  activateMember(memberId: string, memberCode: string): Promise<void>;
  closeOpenCallTasks(memberId: string, reasons: readonly string[], closedAt: Date): Promise<void>;
  enqueueOutbox(event: OutboxEventInput): Promise<void>;
}

export interface DeskPaymentUnitOfWork {
  transaction<T>(work: (store: DeskPaymentStore) => Promise<T>): Promise<T>;
}

export interface DeskPaymentRequest {
  readonly memberId: string;
  readonly planId: string;
  readonly method: DeskPaymentMethod;
  readonly discountPaise?: number;
  readonly discountReason?: string;
}

export interface DeskPaymentResult {
  readonly paymentId: string;
  readonly membershipId: string;
  readonly receiptNo: string;
  readonly memberCode: string;
  readonly amountPaise: number;
  readonly startDate: ISTDate;
  readonly endDate: ISTDate;
}

export async function recordDeskPayment(
  input: DeskPaymentRequest,
  deps: { readonly actor: CrmActor; readonly clock: Clock; readonly uow: DeskPaymentUnitOfWork; readonly settings: CheckoutSettings },
): Promise<DeskPaymentResult> {
  const { actor, settings } = deps;
  assertCan(actor, 'payment.record', deps.clock.now());

  const discountPaise = input.discountPaise ?? 0;
  if (discountPaise > 0) {
    assertCan(actor, 'payment.discount', deps.clock.now());
    if (!settings.pricing.allowDeskDiscounts) {
      throw new DomainError('FORBIDDEN', 'Discounts are switched off for this gym');
    }
    if ((input.discountReason ?? '').trim() === '') {
      throw new DomainError('VALIDATION_FAILED', 'A discount needs a reason');
    }
  }

  return deps.uow.transaction(async (store) => {
    const member = await store.getMemberForDesk(input.memberId);
    if (member === null) throw new DomainError('MEMBER_NOT_FOUND', 'No such member');
    if (member.status === 'BLOCKED') throw new DomainError('MEMBER_BLOCKED', 'This member is blocked');

    const today = todayIST(deps.clock);
    const plan = planForMember({
      plans: await store.getPlans(member.gymId),
      planId: input.planId,
      memberGender: member.gender,
      otherGenderPricing: settings.pricing.otherGenderPricing,
    });

    // Someone who has paid before is renewing (BR-3.4); anyone else starts today (BR-3.3).
    const quote = member.hasConfirmedMembership
      ? prepareRenewalCheckout({ plan, today, currentEndDate: member.latestConfirmedEndDate, settings })
      : prepareSignupCheckout({ plan, today, requestedStartDate: today, isFirstMembership: true, settings });

    if (discountPaise < 0 || discountPaise > quote.totalPaise) {
      throw new DomainError('VALIDATION_FAILED', 'The discount cannot be more than the fee', { totalPaise: quote.totalPaise });
    }
    const amountPaise = quote.totalPaise - discountPaise;
    if (amountPaise <= 0) throw new DomainError('VALIDATION_FAILED', 'The amount taken must be more than zero');

    const now = deps.clock.now();
    const receiptNo = formatReceiptNumber(today, await store.nextCounterValue(member.gymId, receiptCounterKey(today)));

    const membershipId = await store.createConfirmedMembership({
      gymId: member.gymId,
      memberId: member.id,
      planId: plan.id,
      durationMonths: quote.durationMonths,
      startDate: quote.startDate,
      endDate: quote.endDate,
      pricePaise: quote.planPricePaise,
      admissionPaise: quote.admissionPaise,
      discountPaise,
      discountReason: discountPaise > 0 ? (input.discountReason ?? null) : null,
      source: 'CRM',
      createdById: actor.staffUserId,
      confirmedAt: now,
    });

    const paymentId = await store.createPaidPayment({
      gymId: member.gymId,
      memberId: member.id,
      membershipId,
      amountPaise,
      method: input.method,
      receiptNo,
      paidAt: now,
      recordedById: actor.staffUserId,
    });

    const existing = await store.getMember(member.id);
    const memberCode = existing.memberCode ?? formatMemberCode(await store.nextCounterValue(member.gymId, MEMBER_CODE_COUNTER_KEY));
    await store.activateMember(member.id, memberCode);
    await store.closeOpenCallTasks(member.id, CALL_TASKS_CLOSED_BY_PAYMENT, now);

    // No owner alert: they are standing at the desk doing this themselves.
    await store.enqueueOutbox({ type: 'whatsapp.receipt', gymId: member.gymId, payload: { paymentId }, dedupeKey: `receipt:${paymentId}` });
    await store.enqueueOutbox({ type: 'receipt.pdf', gymId: member.gymId, payload: { paymentId }, dedupeKey: `pdf:${paymentId}` });
    await store.enqueueOutbox({ type: 'kiosk.enroll', gymId: member.gymId, payload: { memberId: member.id }, dedupeKey: `enroll:${member.id}` });

    return { paymentId, membershipId, receiptNo, memberCode, amountPaise, startDate: quote.startDate, endDate: quote.endDate };
  });
}
