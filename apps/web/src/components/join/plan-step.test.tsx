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
    expect(onContinue).toHaveBeenCalledWith({ planId: 'plan_m12', startDate: '2026-09-11' });
  });

  it('uses a fixed start date for a renewal instead of offering a choice', async () => {
    const { user, onContinue } = renderStep({ fixedStartDate: istDate('2026-09-20') });

    expect(screen.queryByLabelText('Start date')).toBeNull();
    await user.click(screen.getByRole('radio', { name: /Monthly/ }));
    expect(screen.getByText('Ends on 19 Oct 2026')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
    expect(onContinue).toHaveBeenCalledWith({ planId: 'plan_m1', startDate: '2026-09-20' });
  });

  it('mentions the admission fee and a desk-confirmed price when they apply', () => {
    renderStep({ admissionPaise: 50_000, deskConfirmsPrice: true });
    expect(screen.getByText('Admission fee ₹500, charged once')).toBeTruthy();
    expect(screen.getByText('Final price confirmed at reception.')).toBeTruthy();
  });
});
