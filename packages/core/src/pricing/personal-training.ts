import type { Gender, PlanDurationMonths, PricedGender } from '@mfp/shared';
import { DomainError } from '../errors';
import { findPlanById, pricingGenderFor, type Plan } from './plans';
import { perMonthDisplayPaise, type PricingSettingsInput, type Quote } from './pricing';

/**
 * Personal training (ADR-087; PRD PT-01).
 *
 * PT rides on a membership: the gym floor is what a membership buys, and a trainer's time
 * is the extra. So a PT plan lives in the same catalogue with `kind: 'PT'` — the owner
 * edits both price lists in one place — and three rules keep the two apart.
 *
 * PT never appears on the membership list, so nobody joins the gym "on PT". A PT plan is
 * checked against the member's own price list like any other, so a future male/female
 * split needs no new code — today both lists hold the same four prices. And PT cannot run
 * longer than the membership it rides on, because a trainer booked past the membership is
 * a mis-sale the desk would have to unpick by hand.
 *
 * The price stored is the **total** for the term; the "₹4,500/month" on the card is
 * derived from it (BR-2.3), never the other way round.
 */

export interface PtCardView {
  readonly planId: string;
  readonly code: string;
  readonly durationMonths: PlanDurationMonths;
  /** The whole term, which is what the member pays. */
  readonly pricePaise: number;
  /** Display only (BR-2.3, ADR-016). */
  readonly perMonthPaise: number;
}

/** The PT plans on a member's price list, shortest term first. */
export function ptPlansFor(plans: readonly Plan[], gender: PricedGender): Plan[] {
  return plans
    .filter((plan) => plan.kind === 'PT' && plan.isActive && plan.gender === gender)
    .sort((a, b) => a.durationMonths - b.durationMonths);
}

export function ptCards(plans: readonly Plan[], gender: Gender, settings: Pick<PricingSettingsInput, 'otherGenderPricing'>): PtCardView[] {
  return ptPlansFor(plans, pricingGenderFor(gender, settings.otherGenderPricing)).map((plan) => ({
    planId: plan.id,
    code: plan.code,
    durationMonths: plan.durationMonths,
    pricePaise: plan.pricePaise,
    perMonthPaise: perMonthDisplayPaise(plan),
  }));
}

/** The chosen PT plan, provided it is PT, on sale, and on this member's price list. */
export function ptPlanForMember(input: {
  plans: readonly Plan[];
  planId: string;
  memberGender: Gender;
  otherGenderPricing: PricingSettingsInput['otherGenderPricing'];
}): Plan {
  const plan = findPlanById(input.plans, input.planId);
  if (plan.kind !== 'PT') {
    throw new DomainError('PLAN_KIND_MISMATCH', 'That is a membership plan, not personal training', { planId: plan.id });
  }
  if (plan.gender !== pricingGenderFor(input.memberGender, input.otherGenderPricing)) {
    throw new DomainError('PLAN_GENDER_MISMATCH', "That plan is not on this member's price list", { planId: plan.id });
  }
  return plan;
}

export interface CombinedQuote {
  /** The membership, admission fee and any discount — what it would cost on its own. */
  readonly membershipTotalPaise: number;
  /** 0 when the member said no to PT. */
  readonly ptPricePaise: number;
  readonly ptDurationMonths: PlanDurationMonths | null;
  /** What the order is created for, and what the member is shown before paying. */
  readonly totalPaise: number;
}

/**
 * One payable amount, with the membership and the trainer still visible inside it.
 *
 * The member is shown both lines and the total before paying (PRD PT-04), so the two
 * figures stay separate all the way to the receipt rather than being added up early.
 */
export function combinedQuote(input: {
  readonly membership: Pick<Quote, 'totalPaise'>;
  readonly ptPlan: Plan | null;
  /** The membership's own length, when it is known, for the "not longer than" rule. */
  readonly membershipMonths?: PlanDurationMonths;
}): CombinedQuote {
  const { ptPlan } = input;
  if (ptPlan === null) {
    return { membershipTotalPaise: input.membership.totalPaise, ptPricePaise: 0, ptDurationMonths: null, totalPaise: input.membership.totalPaise };
  }
  if (ptPlan.kind !== 'PT') {
    throw new DomainError('PLAN_KIND_MISMATCH', 'That is a membership plan, not personal training', { planId: ptPlan.id });
  }
  if (input.membershipMonths !== undefined && ptPlan.durationMonths > input.membershipMonths) {
    throw new DomainError('PT_LONGER_THAN_MEMBERSHIP', 'Personal training cannot run longer than the membership it goes with', {
      ptMonths: ptPlan.durationMonths,
      membershipMonths: input.membershipMonths,
    });
  }

  return {
    membershipTotalPaise: input.membership.totalPaise,
    ptPricePaise: ptPlan.pricePaise,
    ptDurationMonths: ptPlan.durationMonths,
    totalPaise: input.membership.totalPaise + ptPlan.pricePaise,
  };
}
