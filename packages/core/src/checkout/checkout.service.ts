import { todayIST, type Clock, type E164Mobile, type Gender, type ISTDate, type MemberStatus } from '@mfp/shared';
import { DomainError } from '../errors';
import type { PaymentProvider } from '../ports/payments';
import type { Plan } from '../pricing/plans';
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
  readonly planId: string;
  readonly durationMonths: number;
  readonly startDate: ISTDate;
  readonly endDate: ISTDate;
  /** Copied from the plan at purchase; later price changes never alter it (BR-2.8). */
  readonly pricePaise: number;
  readonly admissionPaise: number;
  readonly source: 'WEBSITE';
}

/**
 * A retry may reuse an unpaid membership only when it is the same purchase at the same
 * price, and its reservation has not run out — otherwise the membership would record
 * a different fee than the payment charges, or revive an expired hold.
 */
export type ReusableMembershipQuery = PendingMembershipRecord & { readonly createdAfter: Date };

export interface NewPaymentRecord {
  readonly gymId: string;
  readonly memberId: string;
  readonly membershipId: string;
  readonly amountPaise: number;
  readonly method: 'RAZORPAY' | 'SIMULATED';
}

export interface CheckoutStore {
  getMemberForCheckout(memberId: string): Promise<MemberForCheckout | null>;
  /** All plans for the gym, including retired ones, so a stale plan id gets a clear error. */
  getPlans(gymId: string): Promise<readonly Plan[]>;
  /** An unpaid, uncancelled membership matching every field, created after `createdAfter`. */
  findReusablePendingMembership(query: ReusableMembershipQuery): Promise<{ readonly id: string; readonly createdAt: Date } | null>;
  createPendingMembership(record: PendingMembershipRecord): Promise<{ readonly id: string; readonly createdAt: Date }>;
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
  readonly planId: string;
  /** Required for a sign-up; ignored for a renewal, whose start follows BR-3.4. */
  readonly startDate: ISTDate | null;
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

    const plan = planForMember({
      plans: await store.getPlans(member.gymId),
      planId: input.planId,
      memberGender: member.gender,
      otherGenderPricing: deps.settings.pricing.otherGenderPricing,
    });
    const quote = quoteFor(input, member, plan, today, deps.settings);

    const record: PendingMembershipRecord = {
      gymId: member.gymId,
      memberId: member.id,
      planId: plan.id,
      durationMonths: quote.durationMonths,
      startDate: quote.startDate,
      endDate: quote.endDate,
      pricePaise: quote.planPricePaise,
      admissionPaise: quote.admissionPaise,
      source: 'WEBSITE',
    };
    const holdStart = new Date(deps.clock.now().getTime() - PAY_AT_RECEPTION_HOLD_HOURS * 3_600_000);
    const membership =
      (await store.findReusablePendingMembership({ ...record, createdAfter: holdStart })) ??
      (await store.createPendingMembership(record));

    if (input.payAtReception) {
      return { member, quote, membership, paymentId: null };
    }

    const paymentId = await store.createPayment({
      gymId: member.gymId,
      memberId: member.id,
      membershipId: membership.id,
      amountPaise: quote.totalPaise,
      method: deps.provider.name === 'simulated' ? 'SIMULATED' : 'RAZORPAY',
    });
    return { member, quote, membership, paymentId };
  });

  const { member, quote, membership, paymentId } = reserved;
  const membershipView = { id: membership.id, startDate: quote.startDate, endDate: quote.endDate };

  if (paymentId === null) {
    return {
      kind: 'PAY_AT_RECEPTION',
      amountPaise: quote.totalPaise,
      reservedUntil: reservationExpiresAt(membership.createdAt),
      membership: membershipView,
    };
  }

  const order = await deps.provider.createOrder({
    amountPaise: quote.totalPaise,
    currency: 'INR',
    // Our payment id, so the provider's record and ours can always be reconciled.
    receipt: paymentId,
    notes: { memberId: member.id, membershipId: membership.id },
  });
  if (order.amountPaise !== quote.totalPaise) {
    throw new DomainError('PRICE_MISMATCH', 'The payment provider created an order for a different amount');
  }
  await deps.uow.transaction((store) => store.setProviderOrderId(paymentId, order.providerOrderId));

  return {
    kind: 'ONLINE',
    paymentId,
    provider: deps.provider.name,
    providerOrderId: order.providerOrderId,
    publicKeyId: order.publicKeyId,
    amountPaise: quote.totalPaise,
    membership: membershipView,
    prefill: { name: member.fullName, contact: member.mobile, email: member.email },
  };
}
