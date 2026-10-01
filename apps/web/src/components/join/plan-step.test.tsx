import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { istDate } from '@mfp/shared';
import type { PlanCardView } from '@mfp/core';
import { WithIntl } from '@/test/intl';
import { PlanStep } from './plan-step';

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

const card = (durationMonths: number, pricePaise: number, extra: Partial<PlanCardView> = {}): PlanCardView => ({
  planId: `plan_m${durationMonths}`,
  code: `M${durationMonths}_MALE`,
  durationMonths,
  pricePaise,
  perMonthPaise: Math.round(pricePaise / durationMonths),
  savingsPaise: 150_000 * durationMonths - pricePaise,
  showSavings: durationMonths > 1,
  isBestValue: durationMonths === 12,
  ...extra,
});

const CARDS = [card(1, 150_000), card(3, 400_000), card(6, 750_000), card(12, 1_350_000)];

function renderStep(props: Partial<Parameters<typeof PlanStep>[0]> = {}) {
  const onContinue = vi.fn();
  render(
    <WithIntl>
      <PlanStep
        cards={CARDS}
        admissionPaise={0}
        deskConfirmsPrice={false}
        today={istDate('2026-09-11')}
        maxStartDateDaysAhead={15}
        onContinue={onContinue}
        {...props}
      />
    </WithIntl>,
  );
  return { onContinue, user: userEvent.setup() };
}

describe('PlanStep', () => {
  it('shows the monthly plan first, then packages with their saving and one best value', () => {
    renderStep();

    const monthly = screen.getByRole('group', { name: 'Monthly membership' });
    expect(within(monthly).getByRole('radio', { name: /Monthly/ })).toBeTruthy();
    expect(within(monthly).getByText('₹1,500 / month')).toBeTruthy();

    const packages = screen.getByRole('group', { name: 'Save with a package' });
    const options = within(packages).getAllByRole('radio');
    expect(options.map((o) => o.getAttribute('value'))).toEqual(['plan_m3', 'plan_m6', 'plan_m12']);
    expect(within(packages).getByText('save ₹4,500')).toBeTruthy();
    expect(within(packages).getAllByText('Best value')).toHaveLength(1);
  });

  it('starts with the plan picked on the landing page', () => {
    renderStep({ initialPlanCode: 'M6_MALE' });
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /6 months/ }).checked).toBe(true);
  });

  it('previews the end date by the membership rules as plan and start date change', async () => {
    const { user } = renderStep();

    await user.click(screen.getByRole('radio', { name: /Monthly/ }));
    expect(screen.getByText('Ends on 10 Oct 2026')).toBeTruthy();

    await user.click(screen.getByRole('radio', { name: /3 months/ }));
    await user.selectOptions(screen.getByLabelText('Start date'), '2026-09-15');
    expect(screen.getByText('Ends on 14 Dec 2026')).toBeTruthy();
  });

  it('offers start dates from today up to the allowed days ahead', () => {
    renderStep({ maxStartDateDaysAhead: 3 });
    const options = within(screen.getByLabelText('Start date')).getAllByRole('option');
    expect(options.map((o) => o.getAttribute('value'))).toEqual(['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14']);
    expect(options[0]?.textContent).toBe('Today, 11 Sep 2026');
  });

  it('asks for a plan before continuing, then continues with the plan and start date', async () => {
    const { user, onContinue } = renderStep();

    await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
    expect(screen.getByText('Choose a plan to continue.')).toBeTruthy();
    expect(onContinue).not.toHaveBeenCalled();

    await user.click(screen.getByRole('radio', { name: /12 months/ }));
    await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
    expect(onContinue).toHaveBeenCalledWith({ planId: 'plan_m12', trialDays: null, startDate: '2026-09-11', ptPlanId: null });
  });

  describe('the paid trial', () => {
    // ADR-088: ₹100 a day, for somebody deciding whether to join at all.
    const TRIAL = [
      { days: 1, totalPaise: 10_000 },
      { days: 3, totalPaise: 30_000 },
      { days: 7, totalPaise: 70_000 },
    ];

    it('is not offered when the gym does not sell one', () => {
      renderStep();
      expect(screen.queryByText(/trying us out/i)).toBeNull();
    });

    it('is chosen instead of a plan, and carries the days', async () => {
      const { onContinue, user } = renderStep({ trialOptions: TRIAL });

      await user.click(screen.getByRole('radio', { name: /3 days/i }));
      await user.click(screen.getByRole('button', { name: 'Continue to payment' }));

      expect(onContinue).toHaveBeenCalledWith({ planId: null, trialDays: 3, startDate: '2026-09-11', ptPlanId: null });
    });

    it('clears a plan when the trial is chosen, and the trial when a plan is', async () => {
      const { onContinue, user } = renderStep({ trialOptions: TRIAL });

      await user.click(screen.getByRole('radio', { name: /12 months/ }));
      await user.click(screen.getByRole('radio', { name: /7 days/i }));
      await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
      expect(onContinue).toHaveBeenCalledWith({ planId: null, trialDays: 7, startDate: '2026-09-11', ptPlanId: null });

      await user.click(screen.getByRole('radio', { name: /12 months/ }));
      await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
      expect(onContinue).toHaveBeenLastCalledWith({ planId: 'plan_m12', trialDays: null, startDate: '2026-09-11', ptPlanId: null });
    });

    it('does not offer a trainer on a trial', async () => {
      const { user } = renderStep({
        trialOptions: TRIAL,
        ptCards: [{ planId: 'plan_pt1', code: 'PT1_MALE', durationMonths: 1 as const, pricePaise: 500_000, perMonthPaise: 500_000 }],
      });

      await user.click(screen.getByRole('radio', { name: /3 days/i }));
      expect(screen.queryByRole('group', { name: /personal training/i })).toBeNull();
    });
  });

  describe('personal training', () => {
    // ADR-087: the question is asked once, here, where the member can see what it adds.
    const pt = (durationMonths: 1 | 3 | 6 | 12, pricePaise: number) => ({
      planId: `plan_pt${durationMonths}`,
      code: `PT${durationMonths}_MALE`,
      durationMonths,
      pricePaise,
      perMonthPaise: Math.round(pricePaise / durationMonths),
    });
    const PT_CARDS = [pt(1, 500_000), pt(3, 1_350_000), pt(6, 2_400_000), pt(12, 3_600_000)];

    it('is not asked at all when the gym sells no personal training', () => {
      renderStep({ ptCards: [] });
      expect(screen.queryByRole('group', { name: /personal training/i })).toBeNull();
    });

    it('asks, and continues with nothing extra when the answer is no', async () => {
      const { onContinue, user } = renderStep({ ptCards: PT_CARDS });

      expect(screen.getByRole<HTMLInputElement>('radio', { name: 'No' }).checked).toBe(true);
      await user.click(screen.getByRole('radio', { name: /3 months/ }));
      await user.click(screen.getByRole('button', { name: 'Continue to payment' }));

      expect(onContinue).toHaveBeenCalledWith({ planId: 'plan_m3', trialDays: null, startDate: '2026-09-11', ptPlanId: null });
    });

    it('offers only trainer terms that fit inside the membership, and adds the cost up', async () => {
      // Twelve months of a trainer on a three-month membership is a mis-sale (ADR-087).
      const { onContinue, user } = renderStep({ ptCards: PT_CARDS });
      await user.click(screen.getByRole('radio', { name: /3 months/ }));
      await user.click(screen.getByRole('radio', { name: 'Yes' }));

      const group = screen.getByRole('group', { name: /personal training/i });
      expect(within(group).getAllByRole('radio').map((option) => option.getAttribute('value'))).toEqual(['no', 'yes', 'plan_pt1', 'plan_pt3']);

      await user.click(within(group).getByRole('radio', { name: /3 months/ }));
      expect(screen.getByText('Membership ₹4,000 + personal training ₹13,500 = ₹17,500')).toBeTruthy();

      await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
      expect(onContinue).toHaveBeenCalledWith({ planId: 'plan_m3', trialDays: null, startDate: '2026-09-11', ptPlanId: 'plan_pt3' });
    });

    it('drops a trainer term that no longer fits when the membership is shortened, and asks again', async () => {
      const { onContinue, user } = renderStep({ ptCards: PT_CARDS });
      await user.click(screen.getByRole('radio', { name: /12 months/ }));
      await user.click(screen.getByRole('radio', { name: 'Yes' }));
      await user.click(screen.getByRole('radio', { name: /12 months personal training/i }));

      await user.click(screen.getByRole('radio', { name: /Monthly/ }));

      // One month of membership can carry only one month of trainer. The old choice is
      // gone, and the member is asked rather than silently charged either way.
      const group = screen.getByRole('group', { name: /personal training/i });
      expect(within(group).getAllByRole('radio').map((option) => option.getAttribute('value'))).toEqual(['no', 'yes', 'plan_pt1']);
      await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
      expect(onContinue).not.toHaveBeenCalled();

      await user.click(within(group).getByRole('radio', { name: /1 month personal training/i }));
      await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
      expect(onContinue).toHaveBeenCalledWith({ planId: 'plan_m1', trialDays: null, startDate: '2026-09-11', ptPlanId: 'plan_pt1' });
    });

    it('asks for a choice when the member says yes and picks no term', async () => {
      const { onContinue, user } = renderStep({ ptCards: PT_CARDS });
      await user.click(screen.getByRole('radio', { name: /3 months/ }));
      await user.click(screen.getByRole('radio', { name: 'Yes' }));
      await user.click(screen.getByRole('button', { name: 'Continue to payment' }));

      expect(onContinue).not.toHaveBeenCalled();
      expect(screen.getByRole('alert').textContent).toContain('Choose a personal training plan');
    });
  });

  it('uses a fixed start date for a renewal instead of offering a choice', async () => {
    const { user, onContinue } = renderStep({ fixedStartDate: istDate('2026-09-20') });

    expect(screen.queryByLabelText('Start date')).toBeNull();
    await user.click(screen.getByRole('radio', { name: /Monthly/ }));
    expect(screen.getByText('Ends on 19 Oct 2026')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
    expect(onContinue).toHaveBeenCalledWith({ planId: 'plan_m1', trialDays: null, startDate: '2026-09-20', ptPlanId: null });
  });

  it('mentions the admission fee and a desk-confirmed price when they apply', () => {
    renderStep({ admissionPaise: 50_000, deskConfirmsPrice: true });
    expect(screen.getByText('Admission fee ₹500, charged once')).toBeTruthy();
    expect(screen.getByText('Final price confirmed at reception.')).toBeTruthy();
  });
});
