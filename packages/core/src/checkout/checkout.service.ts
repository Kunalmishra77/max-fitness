import { todayIST, type Clock, type E164Mobile, type Gender, type ISTDate, type MemberStatus, type PlanDurationMonths } from '@mfp/shared';
import { DomainError } from '../errors';
import { membershipPeriod } from '../membership/dates';
import type { PaymentProvider } from '../ports/payments';
import { combinedQuote, ptPlanForMember } from '../pricing/personal-training';
import type { Plan } from '../pricing/plans';
import { assertTrialAllowed, trialPeriod, trialQuote } from '../trial/trial';
import {
  PAY_AT_RECEPTION_HOLD_HOURS,
  planForMember,
  prepareRenewalCheckout,
  prepareSignupCheckout,
  reservationExpiresAt,
  type CheckoutQuote,
  type CheckoutSettings,
} from './checkout.rules';

/**
 * Creating a checkout order (signup-and-payment-flow.md §4, §6;
 * api-specification.md `POST /checkout/orders`).
 *
 * One transaction reserves the purchase: a `PENDING_PAYMENT` membership and, for an
 * online payment, a `CREATED` payment. The provider order is created after commit —
 * a network call must not hold a database transaction open — and its id saved in a
 * second, tiny transaction. If the provider call fails, the unpaid payment row is
 * harmless and the next attempt creates a fresh one.
 */

export interface MemberForCheckout {
  readonly id: string;
  readonly gymId: string;
  readonly status: MemberStatus;
  readonly gender: Gender;
  readonly fullName: string;
  readonly mobile: E164Mobile;
  readonly email: string | null;
  /** Any confirmed membership ever — decides the admission fee (BR-2.6). */
  readonly hasConfirmedMembership: boolean;
  /** End date of the latest confirmed membership, for the renewal start rule (BR-3.4). */
  readonly latestConfirmedEndDate: ISTDate | null;
}

export interface PendingMembershipRecord {
  readonly gymId: string;
  readonly memberId: string;
  /** `null` for a trial, which is sold by the day rather than from the catalogue (ADR-088). */
  readonly planId: string | null;
  readonly durationMonths: number | null;
  readonly startDate: ISTDate;
  readonly endDate: ISTDate;
  /** Copied from the plan at purchase; later price changes never alter it (BR-2.8). */
  readonly pricePaise: number;
  readonly admissionPaise: number;
  readonly source: 'WEBSITE';
  readonly isTrial: boolean;
  readonly trialDays: number | null;
}

/**
 * A retry may reuse an unpaid membership only when it is the same purchase at the same
 * price, and its reservation has not run out — otherwise the membership would record
 * a different fee than the payment charges, or revive an expired hold.
 */
export type ReusableMembershipQuery = PendingMembershipRecord & { readonly createdAfter: Date };

/**
 * Personal training held alongside the membership (ADR-087).
 *
 * Its own record from the start, so the gym can answer "who has a trainer, until when"
 * without unpicking payments, and so an unpaid hold can lapse on its own.
 */
export interface PendingPtEnrolmentRecord {
  readonly gymId: string;
  readonly memberId: string;
  readonly planId: string;
  readonly membershipId: string;
  readonly durationMonths: number;
  readonly startDate: ISTDate;
  readonly endDate: ISTDate;
  /** Copied from the plan at purchase; later price changes never alter it (BR-2.8). */
  readonly pricePaise: number;
}

export interface NewPaymentRecord {
  readonly gymId: string;
  readonly memberId: string;
  readonly membershipId: string;
  /** Set when this payment also covers personal training (ADR-087). */
  readonly ptEnrolmentId: string | null;
  readonly amountPaise: number;
  readonly method: 'RAZORPAY' | 'SIMULATED';
}

export interface CheckoutStore {
  getMemberForCheckout(memberId: string): Promise<MemberForCheckout | null>;
  /** All plans for the gym, including retired ones, so a stale plan id gets a clear error. */
  getPlans(gymId: string): Promise<readonly Plan[]>;
  /** An unpaid, uncancelled membership matching every field, created after `createdAfter`. */
  findReusablePendingMembership(query: ReusableMembershipQuery): Promise<{ readonly id: string; readonly createdAt: Date } | null>;
  /**
   * Whether anyone on this number is already a member, or has had a trial (ADR-088).
   * Excludes the applicant's own row, which registration has just created.
   */
  trialHistoryForMobile(
    gymId: string,
    mobile: string,
    exceptMemberId: string,
  ): Promise<{ readonly membersOnThatMobile: number; readonly trialsOnThatMobile: number }>;
  createPendingMembership(record: PendingMembershipRecord): Promise<{ readonly id: string; readonly createdAt: Date }>;
  /** An unpaid, uncancelled enrolment for the same purchase, so a retry books one trainer. */
  findReusablePendingPtEnrolment(query: PendingPtEnrolmentRecord): Promise<{ readonly id: string } | null>;
  createPendingPtEnrolment(record: PendingPtEnrolmentRecord): Promise<{ readonly id: string }>;
  createPayment(record: NewPaymentRecord): Promise<string>;
  setProviderOrderId(paymentId: string, providerOrderId: string): Promise<void>;
}

export interface CheckoutUnitOfWork {
  transaction<T>(work: (store: CheckoutStore) => Promise<T>): Promise<T>;
}

export interface CheckoutDeps {
  readonly clock: Clock;
  readonly uow: CheckoutUnitOfWork;
  readonly provider: PaymentProvider;
  readonly settings: CheckoutSettings;
}

/** `signup` after registration (registration token); `renewal` from a renew link. */
export type CheckoutMode = 'signup' | 'renewal';

export interface CreateCheckoutInput {
  readonly memberId: string;
  /** A plan, or `null` with `trialDays` for a trial — one or the other (ADR-088). */
  readonly planId: string | null;
  /** How many days of trial, instead of a plan. */
  readonly trialDays?: number | null;
  /** Required for a sign-up; ignored for a renewal, whose start follows BR-3.4. */
  readonly startDate: ISTDate | null;
  /** "Do you need personal training?" — `null` is no (ADR-087). */
  readonly ptPlanId?: string | null;
  readonly payAtReception: boolean;
  readonly mode: CheckoutMode;
}

export interface CheckoutMembershipView {
  readonly id: string;
  readonly startDate: ISTDate;
  readonly endDate: ISTDate;
}

export type CreateCheckoutResult =
  | {
      readonly kind: 'ONLINE';
      readonly paymentId: string;
      readonly provider: PaymentProvider['name'];
      readonly providerOrderId: string;
      readonly publicKeyId: string;
      readonly amountPaise: number;
      readonly membership: CheckoutMembershipView;
      readonly prefill: { readonly name: string; readonly contact: E164Mobile; readonly email: string | null };
    }
  | {
      readonly kind: 'PAY_AT_RECEPTION';
      readonly amountPaise: number;
      readonly reservedUntil: Date;
      readonly membership: CheckoutMembershipView;
    };

function assertCheckoutAllowed(member: MemberForCheckout, mode: CheckoutMode): void {
  if (member.status === 'BLOCKED') {
    throw new DomainError('MEMBER_BLOCKED', 'This member cannot buy a membership online');
  }
  if (mode === 'signup' && member.status !== 'PENDING_PAYMENT') {
    throw new DomainError('CONFLICT', 'This registration has already been completed');
  }
  // BR-4.4: a member who left may pay again and return to ACTIVE.
  if (mode === 'renewal' && member.status !== 'ACTIVE' && member.status !== 'LEFT') {
    throw new DomainError('CONFLICT', 'Only a member can renew');
  }
}

function quoteFor(input: CreateCheckoutInput, member: MemberForCheckout, plan: Plan, today: ISTDate, settings: CheckoutSettings): CheckoutQuote {
  if (input.mode === 'renewal') {
    return prepareRenewalCheckout({ plan, today, currentEndDate: member.latestConfirmedEndDate, settings });
  }
  if (input.startDate === null) {
    throw new DomainError('VALIDATION_FAILED', 'A start date is required');
  }
  return prepareSignupCheckout({
    plan,
    today,
    requestedStartDate: input.startDate,
    isFirstMembership: !member.hasConfirmedMembership,
    settings,
  });
}

export async function createCheckoutOrder(input: CreateCheckoutInput, deps: CheckoutDeps): Promise<CreateCheckoutResult> {
  const today = todayIST(deps.clock);

  const reserved = await deps.uow.transaction(async (store) => {
    const member = await store.getMemberForCheckout(input.memberId);
    if (member === null) {
      throw new DomainError('MEMBER_NOT_FOUND', 'No such member');
    }
    assertCheckoutAllowed(member, input.mode);

    // A plan or a trial, never both and never neither (ADR-088).
    const wantsTrial = input.trialDays !== undefined && input.trialDays !== null;
    if (wantsTrial === (input.planId !== null)) {
      throw new DomainError('VALIDATION_FAILED', 'An order is for a plan or for a trial', { field: wantsTrial ? 'trialDays' : 'planId' });
    }

    const wantsPt = input.ptPlanId !== undefined && input.ptPlanId !== null;
    if (wantsTrial && wantsPt) {
      // Three days with a trainer is not something the gym sells, and the PT term would
      // outlive the trial by months.
      throw new DomainError('VALIDATION_FAILED', 'Personal training cannot be bought with a trial', { field: 'ptPlanId' });
    }

    let record: PendingMembershipRecord;
    let durationMonths: PlanDurationMonths | null;
    let membershipTotalPaise: number;

    if (wantsTrial) {
      const days = input.trialDays ?? 0;
      const history = await store.trialHistoryForMobile(member.gymId, member.mobile, member.id);
      assertTrialAllowed(history);
      const trial = trialQuote({ days, settings: deps.settings.trial });
      // A trial starts when the newcomer is standing there, not on a date they pick.
      const period = trialPeriod(today, days);
      record = {
        gymId: member.gymId,
        memberId: member.id,
        planId: null,
        durationMonths: null,
        startDate: period.startDate,
        endDate: period.endDate,
        pricePaise: trial.totalPaise,
        // A trial is not joining, so the joining fee waits until they do (BR-2.6).
        admissionPaise: 0,
        source: 'WEBSITE',
        isTrial: true,
        trialDays: days,
      };
      durationMonths = null;
      membershipTotalPaise = trial.totalPaise;
    } else {
      const plan = planForMember({
        plans: await store.getPlans(member.gymId),
        planId: input.planId ?? '',
        memberGender: member.gender,
        otherGenderPricing: deps.settings.pricing.otherGenderPricing,
      });
      const quote = quoteFor(input, member, plan, today, deps.settings);
      record = {
        gymId: member.gymId,
        memberId: member.id,
        planId: plan.id,
        durationMonths: quote.durationMonths,
        startDate: quote.startDate,
        endDate: quote.endDate,
        pricePaise: quote.planPricePaise,
        admissionPaise: quote.admissionPaise,
        source: 'WEBSITE',
        isTrial: false,
        trialDays: null,
      };
      durationMonths = quote.durationMonths;
      membershipTotalPaise = quote.totalPaise;
    }

    const holdStart = new Date(deps.clock.now().getTime() - PAY_AT_RECEPTION_HOLD_HOURS * 3_600_000);
    const membership =
      (await store.findReusablePendingMembership({ ...record, createdAfter: holdStart })) ??
      (await store.createPendingMembership(record));

    // Personal training, if they asked for one. Priced and length-checked here, on the
    // server, for the same reason the membership is (BR-11.3, ADR-087).
    const ptPlan = !wantsPt
      ? null
      : ptPlanForMember({
          plans: await store.getPlans(member.gymId),
          planId: input.ptPlanId ?? '',
          memberGender: member.gender,
          otherGenderPricing: deps.settings.pricing.otherGenderPricing,
        });
    const combined = combinedQuote({
      membership: { totalPaise: membershipTotalPaise },
      ptPlan,
      ...(durationMonths === null ? {} : { membershipMonths: durationMonths }),
    });
    const quote = { startDate: record.startDate, endDate: record.endDate };

    let ptEnrolmentId: string | null = null;
    if (ptPlan !== null) {
      const ptRecord: PendingPtEnrolmentRecord = {
        gymId: member.gymId,
        memberId: member.id,
        planId: ptPlan.id,
        membershipId: membership.id,
        durationMonths: ptPlan.durationMonths,
        startDate: quote.startDate,
        endDate: membershipPeriod(quote.startDate, ptPlan.durationMonths).endDate,
        pricePaise: ptPlan.pricePaise,
      };
      ptEnrolmentId = ((await store.findReusablePendingPtEnrolment(ptRecord)) ?? (await store.createPendingPtEnrolment(ptRecord))).id;
    }

    if (input.payAtReception) {
      return { member, quote, combined, membership, paymentId: null };
    }

    const paymentId = await store.createPayment({
      gymId: member.gymId,
      memberId: member.id,
      membershipId: membership.id,
      ptEnrolmentId,
      amountPaise: combined.totalPaise,
      method: deps.provider.name === 'simulated' ? 'SIMULATED' : 'RAZORPAY',
    });
    return { member, quote, combined, membership, paymentId };
  });

  const { member, quote, combined, membership, paymentId } = reserved;
  const membershipView = { id: membership.id, startDate: quote.startDate, endDate: quote.endDate };

  if (paymentId === null) {
    return {
      kind: 'PAY_AT_RECEPTION',
      amountPaise: combined.totalPaise,
      reservedUntil: reservationExpiresAt(membership.createdAt),
      membership: membershipView,
    };
  }

  const order = await deps.provider.createOrder({
    amountPaise: combined.totalPaise,
    currency: 'INR',
    // Our payment id, so the provider's record and ours can always be reconciled.
    receipt: paymentId,
    notes: { memberId: member.id, membershipId: membership.id },
  });
  if (order.amountPaise !== combined.totalPaise) {
    throw new DomainError('PRICE_MISMATCH', 'The payment provider created an order for a different amount');
  }
  await deps.uow.transaction((store) => store.setProviderOrderId(paymentId, order.providerOrderId));

  return {
    kind: 'ONLINE',
    paymentId,
    provider: deps.provider.name,
    providerOrderId: order.providerOrderId,
    publicKeyId: order.publicKeyId,
    amountPaise: combined.totalPaise,
    membership: membershipView,
    prefill: { name: member.fullName, contact: member.mobile, email: member.email },
  };
}
