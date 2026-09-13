import {
  PLAN_DURATIONS,
  planCode,
  type Gender,
  type PlanCode,
  type PlanDurationMonths,
  type PricedGender,
} from '@mfp/shared';
import { DomainError } from '../errors';

/**
 * The plan catalogue (BR-2.1): duration × gender → price.
 *
 * A `Plan` row is data, not code — the owner edits prices from the CRM — so the
 * domain works with this shape rather than a Prisma model, and `packages/core`
 * stays free of database imports.
 */
export interface Plan {
  readonly id: string;
  readonly code: PlanCode;
  readonly durationMonths: PlanDurationMonths;
  readonly gender: PricedGender;
  /** Integer paise (CLAUDE.md §2.1). */
  readonly pricePaise: number;
  readonly isActive: boolean;
  readonly sortOrder: number;
}

export function isPlanDuration(months: number): months is PlanDurationMonths {
  return (PLAN_DURATIONS as readonly number[]).includes(months);
}

export function assertPlanDuration(months: number): PlanDurationMonths {
  if (!isPlanDuration(months)) {
    throw new DomainError(
      'INVALID_PLAN_DURATION',
      `Plans run for 1, 3, 6 or 12 months; got ${months}`,
      { months },
    );
  }
  return months;
}

/**
 * The price list a member of this gender sees online.
 *
 * BR-2.5: `OTHER` has no price list of its own. Under the default
 * `ASK_AT_DESK` setting they are shown male prices with a note that the desk
 * confirms the final amount — the alternative, guessing, would be worse.
 */
export function pricingGenderFor(
  gender: Gender,
  otherGenderPricing: 'ASK_AT_DESK' | 'MALE_RATE' | 'FEMALE_RATE',
): PricedGender {
  if (gender === 'MALE' || gender === 'FEMALE') return gender;
  return otherGenderPricing === 'FEMALE_RATE' ? 'FEMALE' : 'MALE';
}

/** True when the UI must show "Final price confirmed at reception" (BR-2.5). */
export function needsDeskPriceConfirmation(
  gender: Gender,
  otherGenderPricing: 'ASK_AT_DESK' | 'MALE_RATE' | 'FEMALE_RATE',
): boolean {
  return gender === 'OTHER' && otherGenderPricing === 'ASK_AT_DESK';
}

/** The active plans for a gender, in display order (shortest first). */
export function plansForGender(plans: readonly Plan[], gender: PricedGender): Plan[] {
  return plans
    .filter((p) => p.isActive && p.gender === gender)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.durationMonths - b.durationMonths);
}

export function findPlan(
  plans: readonly Plan[],
  months: PlanDurationMonths,
  gender: PricedGender,
): Plan {
  const code = planCode(months, gender);
  const plan = plans.find((p) => p.code === code);
  if (plan === undefined) {
    throw new DomainError('PLAN_NOT_FOUND', `No plan with code ${code}`, { code });
  }
  if (!plan.isActive) {
    throw new DomainError('PLAN_INACTIVE', `Plan ${code} is not on sale`, { code });
  }
  return plan;
}

export function findPlanById(plans: readonly Plan[], planId: string): Plan {
  const plan = plans.find((p) => p.id === planId);
  if (plan === undefined) {
    throw new DomainError('PLAN_NOT_FOUND', 'No such plan', { planId });
  }
  if (!plan.isActive) {
    throw new DomainError('PLAN_INACTIVE', 'That plan is no longer on sale', { planId });
  }
  return plan;
}

/** The 1-month plan for a gender — the baseline the "you save" figure compares against (BR-2.4). */
export function monthlyPlanFor(plans: readonly Plan[], gender: PricedGender): Plan | undefined {
  return plans.find((p) => p.gender === gender && p.durationMonths === 1 && p.isActive);
}
