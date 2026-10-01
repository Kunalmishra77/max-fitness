import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WithIntl } from '@/test/intl';
import { RenewFlow } from './renew-flow';

/**
 * Taking fees at the desk (crm-ux-blueprint §6), now with a trainer on the same receipt
 * (ADR-087).
 *
 * The thing that must not break is the three taps: plan, method, confirm. Personal
 * training sits between the first two, defaults to no, and when the gym sells none it is
 * not there at all. The confirm line always says the amount the member is handing over —
 * it is the last chance to notice "₹17,500 cash" when they meant the membership alone.
 */

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));

const PLANS = [
  { planId: 'plan_m1', durationMonths: 1, pricePaise: 150_000, endDate: '2026-10-14' },
  { planId: 'plan_m3', durationMonths: 3, pricePaise: 400_000, endDate: '2026-12-14' },
];

const PT = [
  { planId: 'plan_pt1', durationMonths: 1, pricePaise: 500_000, endDate: '2026-10-14' },
  { planId: 'plan_pt3', durationMonths: 3, pricePaise: 1_350_000, endDate: '2026-12-14' },
];

function flow({ ptPlans = [] as typeof PT } = {}) {
  const action = vi.fn<(planId: string, ptPlanId: string | null, method: string) => Promise<void>>().mockResolvedValue(undefined);
  render(
    <WithIntl>
      <RenewFlow memberName="Rohit Sharma" plans={PLANS} ptPlans={ptPlans} startDate="2026-09-15" locale="en" action={action} />
    </WithIntl>,
  );
  return { action, user: userEvent.setup() };
}

describe('RenewFlow', () => {
  it('stays three taps when the gym sells no personal training', async () => {
    const { action, user } = flow();

    await user.click(screen.getByRole('button', { name: /^3 months ₹/ }));
    expect(screen.queryByText(/trainer/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: /Cash/i }));
    await user.click(screen.getByRole('button', { name: /Yes, received/i }));

    expect(action).toHaveBeenCalledWith('plan_m3', null, 'CASH');
  });

  it('offers only trainer terms that fit the plan, and adds them to the amount', async () => {
    const { action, user } = flow({ ptPlans: PT });

    await user.click(screen.getByRole('button', { name: /^1 month ₹/ }));
    // A three-month trainer on a one-month renewal is a mis-sale (ADR-087).
    expect(screen.getByRole('button', { name: /^1 month with a trainer/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^3 months with a trainer/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: /^1 month with a trainer/ }));
    await user.click(screen.getByRole('button', { name: /Cash/i }));
    expect(screen.getByText(/₹6,500/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Yes, received/i }));
    expect(action).toHaveBeenCalledWith('plan_m1', 'plan_pt1', 'CASH');
  });

  it('drops a trainer term that no longer fits when the plan is changed', async () => {
    const { action, user } = flow({ ptPlans: PT });

    await user.click(screen.getByRole('button', { name: /^3 months ₹/ }));
    await user.click(screen.getByRole('button', { name: /^3 months with a trainer/ }));
    await user.click(screen.getByRole('button', { name: /^1 month ₹/ }));

    await user.click(screen.getByRole('button', { name: /Cash/i }));
    await user.click(screen.getByRole('button', { name: /Yes, received/i }));
    expect(action).toHaveBeenCalledWith('plan_m1', null, 'CASH');
  });
});
