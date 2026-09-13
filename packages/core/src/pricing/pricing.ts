import { roundToNearestTenRupees, type Gender, type PricedGender } from '@mfp/shared';
import { DomainError } from '../errors';
import { monthlyPlanFor, pricingGenderFor, type Plan } from './plans';

/**
 * What a membership costs.
 *
 * BR-2.8 is the rule that matters most here: the price is *copied* onto the
 * Membership at purchase. A price change next year must never alter what someone
 * paid last year, so nothing downstream recomputes an old membership's cost.
 */

export interface PricingSettingsInput {
  /** BR-2.6. Charged once, on a member's first membership. */
  readonly admissionFeePaise: number;
  readonly otherGenderPricing: 'ASK_AT_DESK' | 'MALE_RATE' | 'FEMALE_RATE';
  readonly allowDeskDiscounts: boolean;
}

export interface QuoteInput {
  readonly plan: Plan;
  readonly settings: PricingSettingsInput;
  /** BR-2.6: the admission fee applies only when this is the member's first membership. */
  readonly isFirstMembership: boolean;
  /** BR-2.7. Desk-only, with a reason; the online flow always passes 0. */
  readonly discountPaise?: number;
  readonly discountReason?: string;
}

export interface Quote {
  readonly planPricePaise: number;
  readonly admissionPaise: number;
  readonly discountPaise: number;
  /** What the member actually pays. Never negative. */
  readonly totalPaise: number;
}

/**
 * Price a membership purchase.
 *
 * Server-side only: BR-11.3 requires the amount to be recomputed from the plan and
 * settings at order creation, and any figure the client sends to be ignored.
 */
export function quoteMembership(input: QuoteInput): Quote {
  const { plan, settings, isFirstMembership } = input;
  const discountPaise = input.discountPaise ?? 0;

  if (!Number.isInteger(discountPaise) || discountPaise < 0) {
    throw new DomainError('VALIDATION_FAILED', 'Discount must be a non-negative whole number of paise');
  }
  if (discountPaise > 0 && !settings.allowDeskDiscounts) {
    throw new DomainError('FORBIDDEN', 'Discounts are switched off for this gym (BR-2.7)');
  }
  if (discountPaise > 0 && (input.discountReason ?? '').trim().length === 0) {
    throw new DomainError('VALIDATION_FAILED', 'A discount needs a reason (BR-2.7)');
  }

  const admissionPaise = isFirstMembership ? settings.admissionFeePaise : 0;
  const gross = plan.pricePaise + admissionPaise;

  if (discountPaise > gross) {
    throw new DomainError('VALIDATION_FAILED', 'Discount is larger than the amount due', {
      discountPaise,
      gross,
    });
  }

  return {
    planPricePaise: plan.pricePaise,
    admissionPaise,
    discountPaise,
    totalPaise: gross - discountPaise,
  };
}

/**
 * The "₹1,330/month" figure on a plan card (BR-2.3, ADR-016).
 *
 * Display only. Nobody is ever charged this: BR-2.8 says the membership carries the
 * plan price. The rule reads "floor then round to the nearest ₹10", which specifies
 * two conflicting roundings; ADR-016 settles it as round-to-nearest-₹10 of the exact
 * per-month share.
 */
export function perMonthDisplayPaise(plan: Plan): number {
  return roundToNearestTenRupees(plan.pricePaise / plan.durationMonths);
}

/**
 * "You save ₹500" against paying monthly for the same span (BR-2.4).
 *
 * Returns 0 rather than a negative number: a plan that costs more than 12 monthlies
 * has no saving to advertise, and the card hides the line entirely.
 */
export function savingsPaise(plan: Plan, monthlyPlan: Plan | undefined): number {
  if (monthlyPlan === undefined || plan.durationMonths === 1) return 0;
  const payingMonthly = monthlyPlan.pricePaise * plan.durationMonths;
  return Math.max(0, payingMonthly - plan.pricePaise);
}

/** BR-2.4: the "you save" line appears only when the saving is positive. */
export function shouldShowSavings(plan: Plan, monthlyPlan: Plan | undefined): boolean {
  return savingsPaise(plan, monthlyPlan) > 0;
}

export interface PlanCardView {
  readonly planId: string;
  readonly code: string;
  readonly durationMonths: number;
  readonly pricePaise: number;
  readonly perMonthPaise: number;
  readonly savingsPaise: number;
  readonly showSavings: boolean;
  readonly isBestValue: boolean;
}

/**
 * Everything the plan cards need, computed once in the domain.
 *
 * coding-standards.md §4 keeps business rules out of components, so the UI receives
 * finished numbers and decides only how to draw them.
 *
 * "Best value" marks the single plan with the largest saving — DESIGN-BLUEPRINT §3
 * allows exactly one gold "recommended" marker, so ties resolve to the longer plan.
 */
export function planCards(
  plans: readonly Plan[],
  gender: Gender,
  settings: PricingSettingsInput,
): PlanCardView[] {
  const pricedGender: PricedGender = pricingGenderFor(gender, settings.otherGenderPricing);
  const monthly = monthlyPlanFor(plans, pricedGender);
  const relevant = plans
    .filter((p) => p.isActive && p.gender === pricedGender)
    .sort((a, b) => a.durationMonths - b.durationMonths);

  let bestIndex = -1;
  let bestSaving = 0;
  relevant.forEach((plan, index) => {
    const saving = savingsPaise(plan, monthly);
    if (saving > bestSaving || (saving === bestSaving && saving > 0)) {
      bestSaving = saving;
      bestIndex = index;
    }
  });

  return relevant.map((plan, index) => {
    const saving = savingsPaise(plan, monthly);
    return {
      planId: plan.id,
      code: plan.code,
      durationMonths: plan.durationMonths,
      pricePaise: plan.pricePaise,
      perMonthPaise: perMonthDisplayPaise(plan),
      savingsPaise: saving,
      showSavings: saving > 0,
      isBestValue: index === bestIndex && saving > 0,
    };
  });
}

/**
 * BR-11.3: the server recomputes the amount and refuses to proceed if the client's
 * figure disagrees. A mismatch is either a stale price page or someone editing the
 * request, and both deserve the same answer.
 */
export function assertQuotedAmount(expectedPaise: number, clientPaise: number): void {
  if (expectedPaise !== clientPaise) {
    throw new DomainError('PRICE_MISMATCH', 'The price has changed. Please reload and try again.', {
      expectedPaise,
      clientPaise,
    });
  }
}
