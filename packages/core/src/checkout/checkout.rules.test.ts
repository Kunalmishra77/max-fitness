import { describe, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import { DomainError } from '../errors';
import { buildPlan } from '../testing/builders';
import {
  PAY_AT_RECEPTION_HOLD_HOURS,
  isReservationExpired,
  planForMember,
  prepareRenewalCheckout,
  prepareSignupCheckout,
  reservationExpiresAt,
  type CheckoutSettings,
} from './checkout.rules';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof DomainError ? error.code : 'not a DomainError';
  }
  return undefined;
}

const settings: CheckoutSettings = {
  pricing: { admissionFeePaise: 0, otherGenderPricing: 'ASK_AT_DESK', allowDeskDiscounts: true },
  maxStartDateDaysAhead: 15,
  renewalGraceDays: 5,
};

const maleQuarter = buildPlan({ durationMonths: 3, gender: 'MALE', pricePaise: 400_000 });
const femaleMonthly = buildPlan({ durationMonths: 1, gender: 'FEMALE', pricePaise: 120_000 });
const retired = buildPlan({ id: 'plan-retired', durationMonths: 6, gender: 'MALE', isActive: false });
const plans = [maleQuarter, femaleMonthly, retired];

describe('planForMember', () => {
  it("returns the chosen plan when it matches the member's price list", () => {
    expect(planForMember({ plans, planId: femaleMonthly.id, memberGender: 'FEMALE', otherGenderPricing: 'ASK_AT_DESK' })).toBe(
      femaleMonthly,
    );
  });

  it("refuses a plan from the other gender's price list (BR-2.5)", () => {
    expect(
      codeOf(() => planForMember({ plans, planId: maleQuarter.id, memberGender: 'FEMALE', otherGenderPricing: 'ASK_AT_DESK' })),
    ).toBe('PLAN_GENDER_MISMATCH');
  });

  it('offers male prices to OTHER under ASK_AT_DESK', () => {
    expect(planForMember({ plans, planId: maleQuarter.id, memberGender: 'OTHER', otherGenderPricing: 'ASK_AT_DESK' })).toBe(
      maleQuarter,
    );
  });

  it('refuses a plan that is no longer on sale', () => {
    expect(
      codeOf(() => planForMember({ plans, planId: retired.id, memberGender: 'MALE', otherGenderPricing: 'ASK_AT_DESK' })),
    ).toBe('PLAN_INACTIVE');
  });
});

describe('prepareSignupCheckout', () => {
  const today = istDate('2026-09-10');

  it('prices a first membership from the plan and computes its dates (BR-3.1, BR-11.3)', () => {
    expect(
      prepareSignupCheckout({ plan: maleQuarter, today, requestedStartDate: today, isFirstMembership: true, settings }),
    ).toEqual({
      durationMonths: 3,
      startDate: '2026-09-10',
      endDate: '2026-12-09',
      planPricePaise: 400_000,
      admissionPaise: 0,
      totalPaise: 400_000,
    });
  });

  it('adds the admission fee to a first membership only (BR-2.6)', () => {
    const withFee: CheckoutSettings = { ...settings, pricing: { ...settings.pricing, admissionFeePaise: 50_000 } };
    expect(
      prepareSignupCheckout({ plan: maleQuarter, today, requestedStartDate: today, isFirstMembership: true, settings: withFee })
        .totalPaise,
    ).toBe(450_000);
    expect(
      prepareSignupCheckout({ plan: maleQuarter, today, requestedStartDate: today, isFirstMembership: false, settings: withFee })
        .totalPaise,
    ).toBe(400_000);
  });

  it('allows a start date up to 15 days ahead and no further (BR-3.3)', () => {
    expect(
      prepareSignupCheckout({ plan: maleQuarter, today, requestedStartDate: istDate('2026-09-25'), isFirstMembership: true, settings })
        .startDate,
    ).toBe('2026-09-25');
    expect(
      codeOf(() =>
        prepareSignupCheckout({ plan: maleQuarter, today, requestedStartDate: istDate('2026-09-26'), isFirstMembership: true, settings }),
      ),
    ).toBe('START_DATE_TOO_FAR_AHEAD');
  });

  it('refuses a start date in the past', () => {
    expect(
      codeOf(() =>
        prepareSignupCheckout({ plan: maleQuarter, today, requestedStartDate: istDate('2026-09-09'), isFirstMembership: true, settings }),
      ),
    ).toBe('INVALID_START_DATE');
  });
});

describe('prepareRenewalCheckout', () => {
  const today = istDate('2026-09-15');
  const withFee: CheckoutSettings = { ...settings, pricing: { ...settings.pricing, admissionFeePaise: 50_000 } };

  it('chains on from the old end date when renewing within the grace period (case P6)', () => {
    const quote = prepareRenewalCheckout({ plan: femaleMonthly, today, currentEndDate: istDate('2026-09-12'), settings });
    expect(quote.startDate).toBe('2026-09-13');
    expect(quote.endDate).toBe('2026-10-12');
  });

  it('restarts from the payment date after the grace period (case P7)', () => {
    const quote = prepareRenewalCheckout({ plan: femaleMonthly, today, currentEndDate: istDate('2026-09-01'), settings });
    expect(quote.startDate).toBe('2026-09-15');
  });

  it('chains on when renewing early, while still active', () => {
    const quote = prepareRenewalCheckout({ plan: femaleMonthly, today, currentEndDate: istDate('2026-10-01'), settings });
    expect(quote.startDate).toBe('2026-10-02');
  });

  it('never charges the admission fee on a renewal', () => {
    const quote = prepareRenewalCheckout({ plan: femaleMonthly, today, currentEndDate: istDate('2026-09-12'), settings: withFee });
    expect(quote.admissionPaise).toBe(0);
    expect(quote.totalPaise).toBe(120_000);
  });
});

describe('pay-at-reception reservation', () => {
  const createdAt = new Date('2026-09-10T04:30:00Z');

  it('holds the plan for 48 hours', () => {
    expect(PAY_AT_RECEPTION_HOLD_HOURS).toBe(48);
    expect(reservationExpiresAt(createdAt).toISOString()).toBe('2026-09-12T04:30:00.000Z');
  });

  it('expires exactly at the end of the hold', () => {
    expect(isReservationExpired(createdAt, new Date('2026-09-12T04:29:59Z'))).toBe(false);
    expect(isReservationExpired(createdAt, new Date('2026-09-12T04:30:00Z'))).toBe(true);
  });
});
