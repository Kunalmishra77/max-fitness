import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WithIntl } from '@/test/intl';
import { AutopayPanel, type AutopayView } from './autopay-panel';

// The panel refreshes the page after a change, which needs an app router jsdom has not
// mounted. The same stand-in the other CRM component tests use.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/**
 * A member's standing instruction on their profile (ADR-105).
 *
 * The two mistakes worth testing against are the ones that would cost the gym money.
 *
 * Showing an unauthorised mandate as though the member had signed it: the desk would stop
 * chasing a fee that is never coming.
 *
 * Showing a halted mandate quietly: from the moment Razorpay gives up, the gym is not being
 * paid while every other thing on the page still says the member is paid up.
 */

const mandate = (over: Partial<AutopayView> = {}): AutopayView => ({
  id: 'mandate_1',
  status: 'ACTIVE',
  amount: '₹1,500',
  intervalMonths: 1,
  shortUrl: null,
  nextChargeOn: '1 Nov 2026',
  chargeCount: 3,
  authorised: true,
  ...over,
});

const panel = (over: Partial<Parameters<typeof AutopayPanel>[0]> = {}) => (
  <WithIntl>
    <AutopayPanel
      memberId="mem_1"
      mandate={mandate()}
      canManage
      available
      onStart={vi.fn()}
      onCancel={vi.fn()}
      {...over}
    />
  </WithIntl>
);

describe('AutopayPanel', () => {
  it('offers to set it up when the member has none, and says the fee is collected as usual', () => {
    render(panel({ mandate: null }));

    expect(screen.getByText(/collected the usual way/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /set up automatic payment/i })).toBeTruthy();
  });

  it('shows what is taken and when, for a running mandate', () => {
    render(panel());

    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.getByText(/₹1,500 every month/i)).toBeTruthy();
    expect(screen.getByText('1 Nov 2026')).toBeTruthy();
  });

  it('does not claim a mandate is live before the member has approved it', () => {
    render(panel({ mandate: mandate({ status: 'CREATED', authorised: false, chargeCount: 0, shortUrl: 'https://rzp.io/i/abc' }) }));

    expect(screen.getByText('Waiting for approval')).toBeTruthy();
    expect(screen.getByText(/has not approved it yet/i)).toBeTruthy();
    // And the link is there, so somebody can actually finish it.
    expect(screen.getByRole('link', { name: 'https://rzp.io/i/abc' }).getAttribute('href')).toBe('https://rzp.io/i/abc');
  });

  it('explains a halt rather than leaving it as a word, and offers to set it up again', () => {
    render(panel({ mandate: mandate({ status: 'HALTED' }) }));

    expect(screen.getByText('Stopped by the bank')).toBeTruthy();
    expect(screen.getByText(/collect it at the desk/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /set it up again/i })).toBeTruthy();
  });

  it('asks before stopping a running mandate', async () => {
    const onCancel = vi.fn().mockResolvedValue({ ok: true, status: 'CANCELLED', shortUrl: null, firstChargeOn: null, alreadyLive: false });
    render(panel({ onCancel }));

    await userEvent.click(screen.getByRole('button', { name: /^stop automatic payment$/i }));
    expect(onCancel).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /yes, stop it/i }));
    await waitFor(() => expect(onCancel).toHaveBeenCalledWith('mem_1', 'mandate_1'));
  });

  it('shows the link that comes back from setting one up, so it can be given to the member', async () => {
    const onStart = vi.fn().mockResolvedValue({ ok: true, status: 'CREATED', shortUrl: 'https://rzp.io/i/new', firstChargeOn: '2026-11-01', alreadyLive: false });
    render(panel({ mandate: null, onStart }));

    await userEvent.click(screen.getByRole('button', { name: /set up automatic payment/i }));

    await waitFor(() => expect(screen.getByRole('link', { name: 'https://rzp.io/i/new' })).toBeTruthy());
  });

  it('says why it cannot be done rather than failing silently', async () => {
    const onStart = vi.fn().mockResolvedValue({ ok: false, code: 'NO_PLAN' });
    render(panel({ mandate: null, onStart }));

    await userEvent.click(screen.getByRole('button', { name: /set up automatic payment/i }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/cannot be paid automatically/i));
  });

  it('offers nothing to somebody who may not change it', () => {
    render(panel({ canManage: false }));

    expect(screen.queryByRole('button')).toBeNull();
    // The state is still readable: knowing whether the fee arrives by itself is not a
    // privilege, and a trainer being asked at the desk should be able to answer.
    expect(screen.getByText('Running')).toBeTruthy();
  });

  it('says autopay needs the live gateway rather than offering a button that cannot work', () => {
    render(panel({ mandate: null, available: false }));

    expect(screen.getByText(/needs the live payment gateway/i)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
