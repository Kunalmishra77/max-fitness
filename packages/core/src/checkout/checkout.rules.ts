import type { Gender, ISTDate, PlanDurationMonths } from '@mfp/shared';
import { DomainError } from '../errors';
import { assertValidStartDate, membershipPeriod, renewalStartDate } from '../membership/dates';
import { findPlanById, pricingGenderFor, type Plan } from '../pricing/plans';
import { quoteMembership, type PricingSettingsInput } from '../pricing/pricing';

/**
 * Checkout rules (signup-and-payment-flow.md §4; BR-2, BR-3, BR-11.3).
 *
 * Everything an order needs is decided here, on the server, from the plan and
 * settings: which plan the member may buy, when it starts, when it ends and what it
 * costs. Nothing the browser sends about price or dates is trusted.
 */

export interface CheckoutSettings {
  readonly pricing: PricingSettingsInput;
  /** BR-3.3, default 15. */
  readonly maxStartDateDaysAhead: number;
  /** BR-3.4, default 5. */
  readonly renewalGraceDays: number;
}

export interface CheckoutQuote {
  readonly durationMonths: PlanDurationMonths;
  readonly startDate: ISTDate;
  readonly endDate: ISTDate;
  readonly planPricePaise: number;
  readonly admissionPaise: number;
  /** What the order is created for (BR-11.3). */
  readonly totalPaise: number;
}

/** The chosen plan, provided it is on sale and on this member's price list (BR-2.5). */
export function planForMember(input: {
  plans: readonly Plan[];
  planId: string;
  memberGender: Gender;
  otherGenderPricing: PricingSettingsInput['otherGenderPricing'];
}): Plan {
  const plan = findPlanById(input.plans, input.planId);
  if (plan.gender !== pricingGenderFor(input.memberGender, input.otherGenderPricing)) {
    throw new DomainError('PLAN_GENDER_MISMATCH', "That plan is not on this member's price list", {
      planId: plan.id,
    });
  }
  return plan;
}

function quoteFor(plan: Plan, startDate: ISTDate, isFirstMembership: boolean, settings: CheckoutSettings): CheckoutQuote {
  const { endDate } = membershipPeriod(startDate, plan.durationMonths);
  const quote = quoteMembership({ plan, settings: settings.pricing, isFirstMembership });
  return {
    durationMonths: plan.durationMonths,
    startDate,
    endDate,
    planPricePaise: quote.planPricePaise,
    admissionPaise: quote.admissionPaise,
    totalPaise: quote.totalPaise,
  };
}

/** A new member's first purchase: start today or up to the configured days ahead (BR-3.3). */
export function prepareSignupCheckout(input: {
  plan: Plan;
  today: ISTDate;
  requestedStartDate: ISTDate;
  isFirstMembership: boolean;
  settings: CheckoutSettings;
}): CheckoutQuote {
  assertValidStartDate(input.requestedStartDate, input.today, input.settings.maxStartDateDaysAhead);
  return quoteFor(input.plan, input.requestedStartDate, input.isFirstMembership, input.settings);
}

/** A renewal: the start date follows BR-3.4 and the admission fee never applies (BR-2.6). */
export function prepareRenewalCheckout(input: {
  plan: Plan;
  today: ISTDate;
  currentEndDate: ISTDate | null;
  settings: CheckoutSettings;
}): CheckoutQuote {
  const startDate = renewalStartDate({
    currentEndDate: input.currentEndDate,
    paymentDate: input.today,
    renewalGraceDays: input.settings.renewalGraceDays,
  });
  return quoteFor(input.plan, startDate, false, input.settings);
}

/** signup-and-payment-flow.md §6: "Pay at reception" holds the plan this long. */
export const PAY_AT_RECEPTION_HOLD_HOURS = 48;

const HOUR_MS = 3_600_000;

/**
 * When a pay-at-reception reservation lapses. Derived from the pending membership's
 * creation time rather than stored, so there is no second clock to keep in step.
 */
export function reservationExpiresAt(createdAt: Date, holdHours = PAY_AT_RECEPTION_HOLD_HOURS): Date {
  return new Date(createdAt.getTime() + holdHours * HOUR_MS);
}

export function isReservationExpired(createdAt: Date, now: Date, holdHours = PAY_AT_RECEPTION_HOLD_HOURS): boolean {
  return now.getTime() >= reservationExpiresAt(createdAt, holdHours).getTime();
}
