import { istTime, slotToUtc, type Clock, type ISTDate } from '@mfp/shared';
import { DomainError } from '../errors';
import type { OutboxEventInput } from '../ports/outbox';
import type { SubscriptionProvider } from '../ports/payments';
import { firstChargeDate, mandateCycleCount, type MandateStatus } from './mandate';

/**
 * Setting up a standing instruction for one member (ADR-105).
 *
 * The same function serves all three ways it is reached — a new member at the end of
 * sign-up, an existing member sent a link, and the desk setting one up while the member
 * stands there — because the decision is the same in all three: which plan, and from when.
 *
 * It is deliberately not possible to end up with two live mandates. A member who already has
 * one gets it back, link included; two would debit the same fee twice, and a member whose
 * bank took the fee twice does not care which code path did it.
 */

/** What the repository must produce for a member before a mandate can be made. */
export interface MandateCandidate {
  readonly memberId: string;
  readonly gymId: string;
  /** The plan the mandate charges for: the member's current one, or an explicitly chosen one. */
  readonly planId: string;
  readonly planCode: string;
  readonly pricePaise: number;
  readonly durationMonths: number;
  /** `null` when the gym's plan row has no Razorpay plan behind it yet. */
  readonly providerPlanId: string | null;
  /** The last date the member's cover runs to, or `null` when they hold none. */
  readonly coveredUntil: ISTDate | null;
  /** Set when the member already holds a mandate that money can still arrive on. */
  readonly liveMandate: {
    readonly id: string;
    readonly status: MandateStatus;
    readonly shortUrl: string | null;
    readonly nextChargeOn: ISTDate | null;
  } | null;
}

export interface NewMandateRecord {
  readonly gymId: string;
  readonly memberId: string;
  readonly planId: string;
  readonly providerSubscriptionId: string;
  readonly providerPlanId: string;
  readonly status: MandateStatus;
  readonly amountPaise: number;
  readonly intervalMonths: number;
  readonly shortUrl: string | null;
  readonly nextChargeOn: ISTDate | null;
}

export interface StartMandateStore {
  findCandidate(input: { memberId: string; gymId: string; planId?: string }): Promise<MandateCandidate | null>;
  createMandate(record: NewMandateRecord): Promise<{ readonly id: string }>;
  enqueueOutbox(event: OutboxEventInput): Promise<void>;
}

export interface StartMandateUnitOfWork {
  transaction<T>(work: (store: StartMandateStore) => Promise<T>): Promise<T>;
}

export interface StartMandateInput {
  readonly memberId: string;
  readonly gymId: string;
  /** Defaults to whatever the member is on. Given to move them onto a different term. */
  readonly planId?: string;
  /**
   * Whether to WhatsApp the member the link. Default true. The desk turns it off when the
   * member is standing in front of them and the link is already on screen.
   */
  readonly notify?: boolean;
}

export type StartMandateResult =
  | {
      readonly outcome: 'CREATED';
      readonly mandateId: string;
      readonly status: MandateStatus;
      readonly shortUrl: string | null;
      readonly firstChargeOn: ISTDate;
    }
  | {
      readonly outcome: 'ALREADY_LIVE';
      readonly mandateId: string;
      readonly status: MandateStatus;
      readonly shortUrl: string | null;
      readonly firstChargeOn: ISTDate | null;
    };

/** Midnight, Asia/Kolkata — the start of the business day the debit belongs to. */
const START_OF_DAY = istTime('00:00');

export async function startMandate(
  input: StartMandateInput,
  deps: { clock: Clock; provider: SubscriptionProvider; uow: StartMandateUnitOfWork },
): Promise<StartMandateResult> {
  // The provider call is outside the transaction on purpose: it is a network round trip to
  // Razorpay, and holding a database transaction open across one is how a pool runs dry.
  // The cost is that a subscription can exist at Razorpay with no row here — which is why the
  // worker reconciles, and why an unauthorised mandate is harmless either way.
  const candidate = await deps.uow.transaction((store) =>
    store.findCandidate({ memberId: input.memberId, gymId: input.gymId, ...(input.planId === undefined ? {} : { planId: input.planId }) }),
  );
  if (candidate === null) {
    throw new DomainError('MEMBER_NOT_FOUND', 'No such member at this gym', { memberId: input.memberId });
  }

  if (candidate.liveMandate !== null) {
    const live = candidate.liveMandate;
    return {
      outcome: 'ALREADY_LIVE',
      mandateId: live.id,
      status: live.status,
      shortUrl: live.shortUrl,
      firstChargeOn: live.nextChargeOn,
    };
  }

  if (candidate.providerPlanId === null) {
    throw new DomainError('VALIDATION_FAILED', 'That plan has no Razorpay plan behind it, so autopay cannot be set up for it', {
      planCode: candidate.planCode,
    });
  }

  const firstChargeOn = firstChargeDate({ coveredUntil: candidate.coveredUntil, clock: deps.clock });
  const subscription = await deps.provider.createSubscription({
    providerPlanId: candidate.providerPlanId,
    totalCount: mandateCycleCount(candidate.durationMonths),
    startAt: slotToUtc(firstChargeOn, START_OF_DAY),
    // Enough to reconcile a Razorpay subscription back to this gym and member by hand.
    notes: { memberId: candidate.memberId, gymId: candidate.gymId, planCode: candidate.planCode },
  });

  return deps.uow.transaction(async (store) => {
    const mandate = await store.createMandate({
      gymId: candidate.gymId,
      memberId: candidate.memberId,
      planId: candidate.planId,
      providerSubscriptionId: subscription.providerSubscriptionId,
      providerPlanId: candidate.providerPlanId as string,
      status: 'CREATED',
      // Frozen here. Razorpay's plan is immutable, so these two must agree for the life of
      // the mandate even if the gym later changes its price list.
      amountPaise: candidate.pricePaise,
      intervalMonths: candidate.durationMonths,
      shortUrl: subscription.shortUrl,
      nextChargeOn: firstChargeOn,
    });

    if (input.notify !== false) {
      await store.enqueueOutbox({
        type: 'whatsapp.mandate_invite',
        gymId: candidate.gymId,
        payload: { mandateId: mandate.id, memberId: candidate.memberId },
        dedupeKey: `mandate-invite:${mandate.id}`,
      });
    }

    return {
      outcome: 'CREATED',
      mandateId: mandate.id,
      status: 'CREATED',
      shortUrl: subscription.shortUrl,
      firstChargeOn,
    };
  });
}
