import { describe, expect, it } from 'vitest';
import { formatINR } from '@mfp/shared';
import { DomainError } from '../errors';
import { buildPlan, buildPlanCatalogue } from '../testing/builders';
import {
  assertPlanDuration,
  findPlan,
  findPlanById,
  isPlanDuration,
  monthlyPlanFor,
  needsDeskPriceConfirmation,
  plansForGender,
  pricingGenderFor,
} from './plans';
import {
  assertQuotedAmount,
  perMonthDisplayPaise,
  planCards,
  quoteMembership,
  savingsPaise,
  shouldShowSavings,
  type PricingSettingsInput,
} from './pricing';

const settings: PricingSettingsInput = {
  admissionFeePaise: 0,
  otherGenderPricing: 'ASK_AT_DESK',
  allowDeskDiscounts: true,
};

describe('plan catalogue — BR-2.1 and BR-2.2', () => {
  const plans = buildPlanCatalogue();

  it('has eight plans: four durations × two priced genders', () => {
    expect(plans).toHaveLength(8);
  });

  it('carries the default prices from the rule table', () => {
    expect(findPlan(plans, 1, 'MALE').pricePaise).toBe(150_000); // ₹1,500
    expect(findPlan(plans, 1, 'FEMALE').pricePaise).toBe(120_000); // ₹1,200
    expect(findPlan(plans, 3, 'MALE').pricePaise).toBe(400_000);
    expect(findPlan(plans, 6, 'FEMALE').pricePaise).toBe(600_000);
    expect(findPlan(plans, 12, 'MALE').pricePaise).toBe(1_350_000);
  });

  it('validates plan durations', () => {
    expect(isPlanDuration(3)).toBe(true);
    expect(isPlanDuration(2)).toBe(false);
    expect(assertPlanDuration(12)).toBe(12);
    expect(() => assertPlanDuration(2)).toThrow(DomainError);
  });

  it('finds by id and refuses a retired plan', () => {
    const retired = buildPlan({ durationMonths: 3, isActive: false });
    expect(() => findPlanById([retired], retired.id)).toThrow(/no longer on sale/);
    expect(() => findPlanById(plans, 'nope')).toThrow(DomainError);
    expect(() => findPlan([retired], 3, 'MALE')).toThrow(DomainError);
    expect(() => findPlan(plans, 3, 'FEMALE')).not.toThrow();
  });

  it('lists a gender in display order', () => {
    const female = plansForGender(plans, 'FEMALE');
    expect(female.map((p) => p.durationMonths)).toEqual([1, 3, 6, 12]);
    expect(female.every((p) => p.gender === 'FEMALE')).toBe(true);
  });

  it('finds the monthly baseline plan', () => {
    expect(monthlyPlanFor(plans, 'MALE')?.pricePaise).toBe(150_000);
    expect(monthlyPlanFor([], 'MALE')).toBeUndefined();
  });
});

describe('gender pricing — BR-2.5', () => {
  it('uses the member’s own price list for MALE and FEMALE', () => {
    expect(pricingGenderFor('MALE', 'ASK_AT_DESK')).toBe('MALE');
    expect(pricingGenderFor('FEMALE', 'ASK_AT_DESK')).toBe('FEMALE');
  });

  it('shows OTHER the male prices under the default setting', () => {
    expect(pricingGenderFor('OTHER', 'ASK_AT_DESK')).toBe('MALE');
    expect(needsDeskPriceConfirmation('OTHER', 'ASK_AT_DESK')).toBe(true);
  });

  it('honours an explicit override for OTHER, with no desk note', () => {
    expect(pricingGenderFor('OTHER', 'FEMALE_RATE')).toBe('FEMALE');
    expect(pricingGenderFor('OTHER', 'MALE_RATE')).toBe('MALE');
    expect(needsDeskPriceConfirmation('OTHER', 'FEMALE_RATE')).toBe(false);
  });

  it('never asks MALE or FEMALE members to confirm at the desk', () => {
    expect(needsDeskPriceConfirmation('MALE', 'ASK_AT_DESK')).toBe(false);
    expect(needsDeskPriceConfirmation('FEMALE', 'ASK_AT_DESK')).toBe(false);
  });
});

describe('quoteMembership — BR-2.6, BR-2.7', () => {
  const plan = buildPlan({ durationMonths: 1, gender: 'MALE' }); // ₹1,500

  it('quotes the plan price with no admission fee by default', () => {
    expect(quoteMembership({ plan, settings, isFirstMembership: true })).toEqual({
      planPricePaise: 150_000,
      admissionPaise: 0,
      discountPaise: 0,
      totalPaise: 150_000,
    });
  });

  it('adds the admission fee on a first membership only — BR-2.6', () => {
    const withFee = { ...settings, admissionFeePaise: 50_000 };
    expect(quoteMembership({ plan, settings: withFee, isFirstMembership: true }).totalPaise).toBe(200_000);
    expect(quoteMembership({ plan, settings: withFee, isFirstMembership: false })).toMatchObject({
      admissionPaise: 0,
      totalPaise: 150_000,
    });
  });

  it('applies a desk discount with a reason — BR-2.7', () => {
    const quote = quoteMembership({
      plan,
      settings,
      isFirstMembership: false,
      discountPaise: 20_000,
      discountReason: 'Long-standing member',
    });
    expect(quote).toMatchObject({ discountPaise: 20_000, totalPaise: 130_000 });
  });

  it('refuses a discount with no reason', () => {
    expect(() =>
      quoteMembership({ plan, settings, isFirstMembership: false, discountPaise: 20_000 }),
    ).toThrow(/reason/);
    expect(() =>
      quoteMembership({ plan, settings, isFirstMembership: false, discountPaise: 20_000, discountReason: '  ' }),
    ).toThrow(/reason/);
  });

  it('refuses a discount when the gym has them switched off', () => {
    expect(() =>
      quoteMembership({
        plan,
        settings: { ...settings, allowDeskDiscounts: false },
        isFirstMembership: false,
        discountPaise: 1_000,
        discountReason: 'why not',
      }),
    ).toThrow(DomainError);
  });

  it('refuses a discount larger than the bill, which would owe the member money', () => {
    expect(() =>
      quoteMembership({
        plan,
        settings,
        isFirstMembership: false,
        discountPaise: 200_000,
        discountReason: 'oops',
      }),
    ).toThrow(/larger than/);
  });

  it('refuses a fractional or negative discount — money is integer paise', () => {
    expect(() =>
      quoteMembership({ plan, settings, isFirstMembership: false, discountPaise: 10.5, discountReason: 'x' }),
    ).toThrow(DomainError);
    expect(() =>
      quoteMembership({ plan, settings, isFirstMembership: false, discountPaise: -10, discountReason: 'x' }),
    ).toThrow(DomainError);
  });
});

describe('perMonthDisplayPaise — BR-2.3 as settled by ADR-016', () => {
  it('is exact when the division is clean', () => {
    expect(formatINR(perMonthDisplayPaise(buildPlan({ durationMonths: 1 })))).toBe('₹1,500');
    expect(formatINR(perMonthDisplayPaise(buildPlan({ durationMonths: 6 })))).toBe('₹1,250');
  });

  it('rounds to the nearest ₹10 when it is not', () => {
    // ₹4,000 / 3 = ₹1,333.33 -> ₹1,330
    expect(formatINR(perMonthDisplayPaise(buildPlan({ durationMonths: 3 })))).toBe('₹1,330');
    // ₹13,500 / 12 = ₹1,125 -> ₹1,130
    expect(formatINR(perMonthDisplayPaise(buildPlan({ durationMonths: 12 })))).toBe('₹1,130');
    // ₹3,200 / 3 = ₹1,066.67 -> ₹1,070
    expect(formatINR(perMonthDisplayPaise(buildPlan({ durationMonths: 3, gender: 'FEMALE' })))).toBe('₹1,070');
  });

  it('always returns whole rupees in multiples of ten', () => {
    for (const plan of buildPlanCatalogue()) {
      expect(perMonthDisplayPaise(plan) % 1000).toBe(0);
    }
  });
});

describe('savingsPaise — BR-2.4', () => {
  const plans = buildPlanCatalogue();
  const monthly = monthlyPlanFor(plans, 'MALE');

  it('compares against paying monthly for the same span', () => {
    // 3 × ₹1,500 = ₹4,500 vs ₹4,000 -> saves ₹500
    expect(savingsPaise(findPlan(plans, 3, 'MALE'), monthly)).toBe(50_000);
    // 12 × ₹1,500 = ₹18,000 vs ₹13,500 -> saves ₹4,500
    expect(savingsPaise(findPlan(plans, 12, 'MALE'), monthly)).toBe(450_000);
  });

  it('is zero for the monthly plan itself', () => {
    expect(savingsPaise(findPlan(plans, 1, 'MALE'), monthly)).toBe(0);
    expect(shouldShowSavings(findPlan(plans, 1, 'MALE'), monthly)).toBe(false);
  });

  it('never goes negative — a plan with no saving simply hides the line', () => {
    const overpriced = buildPlan({ durationMonths: 3, pricePaise: 500_000 });
    expect(savingsPaise(overpriced, monthly)).toBe(0);
    expect(shouldShowSavings(overpriced, monthly)).toBe(false);
  });

  it('is zero when there is no monthly plan to compare against', () => {
    expect(savingsPaise(findPlan(plans, 3, 'MALE'), undefined)).toBe(0);
  });
});

describe('planCards', () => {
  const plans = buildPlanCatalogue();

  it('returns the four plans for a gender in ascending duration', () => {
    const cards = planCards(plans, 'FEMALE', settings);
    expect(cards.map((c) => c.durationMonths)).toEqual([1, 3, 6, 12]);
    expect(cards.map((c) => c.code)).toEqual(['M1_FEMALE', 'M3_FEMALE', 'M6_FEMALE', 'M12_FEMALE']);
  });

  it('gives OTHER the male cards under ASK_AT_DESK — BR-2.5', () => {
    expect(planCards(plans, 'OTHER', settings).map((c) => c.code)).toEqual([
      'M1_MALE',
      'M3_MALE',
      'M6_MALE',
      'M12_MALE',
    ]);
  });

  it('marks exactly one best-value plan — DESIGN-BLUEPRINT §3 allows one gold marker', () => {
    const cards = planCards(plans, 'MALE', settings);
    const best = cards.filter((c) => c.isBestValue);
    expect(best).toHaveLength(1);
    expect(best[0]?.durationMonths).toBe(12);
  });

  it('marks nothing when no plan saves anything', () => {
    const flat = [
      buildPlan({ durationMonths: 1, pricePaise: 150_000 }),
      buildPlan({ durationMonths: 3, pricePaise: 450_000 }),
    ];
    expect(planCards(flat, 'MALE', settings).some((c) => c.isBestValue)).toBe(false);
  });

  it('excludes retired plans', () => {
    const withRetired = plans.map((p) => (p.durationMonths === 6 ? { ...p, isActive: false } : p));
    expect(planCards(withRetired, 'MALE', settings).map((c) => c.durationMonths)).toEqual([1, 3, 12]);
  });

  it('shows the saving line only where there is one', () => {
    const cards = planCards(plans, 'MALE', settings);
    expect(cards[0]?.showSavings).toBe(false);
    expect(cards[1]?.showSavings).toBe(true);
  });
});

describe('assertQuotedAmount — BR-11.3', () => {
  it('accepts a matching amount', () => {
    expect(() => assertQuotedAmount(150_000, 150_000)).not.toThrow();
  });

  it('rejects a client-supplied amount that disagrees with the server', () => {
    expect(() => assertQuotedAmount(150_000, 100)).toThrow(DomainError);
    expect(() => assertQuotedAmount(150_000, 100)).toThrow(/price has changed/i);
  });
});
