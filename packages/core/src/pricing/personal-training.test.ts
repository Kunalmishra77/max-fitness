import { describe, expect, it } from 'vitest';
import { DEFAULT_PT_PRICES_PAISE, ptPlanCode, type PlanDurationMonths } from '@mfp/shared';
import { plansForGender, type Plan } from './plans';
import { planCards } from './pricing';
import { combinedQuote, ptCards, ptPlanForMember, ptPlansFor } from './personal-training';

/**
 * Personal training (ADR-087).
 *
 * PT is sold alongside a membership, never instead of one: the gym's floor is open to
 * every member, and a trainer's time is the extra. So PT rows live in the same plan table
 * with `kind: 'PT'`, and the two things that must never happen are PT appearing on the
 * membership price list and a PT price being charged without a membership behind it.
 *
 * The price is stored as the total for the term because that is what the member pays; the
 * "₹4,500/month" on the card is derived from it.
 */

const plan = (over: Partial<Plan> & Pick<Plan, 'id' | 'code' | 'durationMonths' | 'pricePaise'>): Plan => ({
  gender: 'MALE',
  kind: 'MEMBERSHIP',
  isActive: true,
  sortOrder: 0,
  ...over,
});

const pt = (months: PlanDurationMonths): Plan =>
  plan({
    id: `pt_${months}`,
    code: ptPlanCode(months, 'MALE'),
    kind: 'PT',
    durationMonths: months,
    pricePaise: DEFAULT_PT_PRICES_PAISE[months],
  });

const membership = plan({ id: 'm1', code: 'M1_MALE', durationMonths: 1, pricePaise: 150_000 });
const sixMonth = plan({ id: 'm6', code: 'M6_MALE', durationMonths: 6, pricePaise: 600_000 });
const catalogue: readonly Plan[] = [membership, sixMonth, pt(1), pt(3), pt(6), pt(12)];

const settings = { admissionFeePaise: 0, otherGenderPricing: 'ASK_AT_DESK' as const, allowDeskDiscounts: true };

describe('personal training in the catalogue', () => {
  it('keeps PT off the membership price list', () => {
    // Otherwise a member joining the gym is offered "PT 3 months" as a membership.
    expect(plansForGender(catalogue, 'MALE').map((p) => p.id)).toEqual(['m1', 'm6']);
    expect(planCards(catalogue, 'MALE', settings).map((card) => card.code)).toEqual(['M1_MALE', 'M6_MALE']);
  });

  it('lists the PT plans on their own, shortest term first', () => {
    expect(ptPlansFor(catalogue, 'MALE').map((p) => p.durationMonths)).toEqual([1, 3, 6, 12]);
  });

  it('leaves out a PT plan the owner has switched off', () => {
    const withoutSix = catalogue.map((p) => (p.id === 'pt_6' ? { ...p, isActive: false } : p));
    expect(ptPlansFor(withoutSix, 'MALE').map((p) => p.durationMonths)).toEqual([1, 3, 12]);
  });

  it('shows the total and the per-month figure the gym quotes', () => {
    const cards = ptCards(catalogue, 'MALE', settings);
    expect(cards.map((card) => [card.durationMonths, card.pricePaise, card.perMonthPaise])).toEqual([
      [1, 500_000, 500_000],
      [3, 1_350_000, 450_000],
      [6, 2_400_000, 400_000],
      [12, 3_600_000, 300_000],
    ]);
  });
});

describe('ptPlanForMember', () => {
  it('refuses a PT plan from the other price list', () => {
    const female = plan({ id: 'pt_3_f', code: ptPlanCode(3, 'FEMALE'), kind: 'PT', gender: 'FEMALE', durationMonths: 3, pricePaise: 1_350_000 });
    expect(() => ptPlanForMember({ plans: [...catalogue, female], planId: 'pt_3_f', memberGender: 'MALE', otherGenderPricing: 'ASK_AT_DESK' })).toThrow(
      expect.objectContaining({ code: 'PLAN_GENDER_MISMATCH' }) as Error,
    );
  });

  it('refuses a membership plan offered as PT', () => {
    expect(() => ptPlanForMember({ plans: catalogue, planId: 'm6', memberGender: 'MALE', otherGenderPricing: 'ASK_AT_DESK' })).toThrow(
      expect.objectContaining({ code: 'PLAN_KIND_MISMATCH' }) as Error,
    );
  });

  it('returns the PT plan when it is on this member list and on sale', () => {
    expect(ptPlanForMember({ plans: catalogue, planId: 'pt_3', memberGender: 'MALE', otherGenderPricing: 'ASK_AT_DESK' }).durationMonths).toBe(3);
  });
});

describe('combinedQuote', () => {
  const membershipQuote = { planPricePaise: 600_000, admissionPaise: 50_000, discountPaise: 0, totalPaise: 650_000 };

  it('adds PT to the membership and keeps the two amounts apart', () => {
    const quote = combinedQuote({ membership: membershipQuote, ptPlan: pt(3) });
    expect(quote.membershipTotalPaise).toBe(650_000);
    expect(quote.ptPricePaise).toBe(1_350_000);
    expect(quote.totalPaise).toBe(2_000_000);
  });

  it('is the membership alone when the member said no to PT', () => {
    const quote = combinedQuote({ membership: membershipQuote, ptPlan: null });
    expect(quote.ptPricePaise).toBe(0);
    expect(quote.totalPaise).toBe(650_000);
  });

  it('refuses a PT plan longer than the membership it rides on', () => {
    // Twelve months of a trainer against a six-month membership is a mis-sale, not a deal.
    expect(() => combinedQuote({ membership: membershipQuote, ptPlan: pt(12), membershipMonths: 6 })).toThrow(
      expect.objectContaining({ code: 'PT_LONGER_THAN_MEMBERSHIP' }) as Error,
    );
  });

  it('allows PT shorter than or equal to the membership', () => {
    expect(combinedQuote({ membership: membershipQuote, ptPlan: pt(6), membershipMonths: 6 }).totalPaise).toBe(3_050_000);
    expect(combinedQuote({ membership: membershipQuote, ptPlan: pt(1), membershipMonths: 6 }).totalPaise).toBe(1_150_000);
  });
});
