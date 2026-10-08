import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WithIntl } from '@/test/intl';
import { AutopayOffer } from './autopay-offer';

/**
 * The standing instruction, as an offer and as the rest of a choice already made.
 *
 * A member who ticked "cash" is asked; a member who ticked "online" is not asked again,
 * because they answered that question on the form (owner, 2026-10-08). The difference is
 * the whole point of `required`, and it is the thing worth a test: an offer that quietly
 * keeps a "would you like?" button is a step members skip.
 */

const MANDATE = { data: { authoriseUrl: 'https://rzp.example/auth/abc', firstChargeOn: '2026-12-01' } };

let gateway: ReturnType<typeof vi.fn>;

beforeEach(() => {
  gateway = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(MANDATE) }));
  vi.stubGlobal('fetch', gateway);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const offer = (props: Partial<Parameters<typeof AutopayOffer>[0]> = {}) =>
  render(
    <WithIntl>
      <AutopayOffer auth={{ kind: 'autopay', token: 'tok' }} endDate="2026-11-30" {...props} />
    </WithIntl>,
  );

describe('AutopayOffer', () => {
  it('asks first, and touches the gateway only once the member says yes', async () => {
    offer();

    expect(gateway).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Set up/i }));

    await waitFor(() => expect(screen.getByRole('link', { name: /Approve/i })).toBeTruthy());
  });

  describe('when the member already chose to pay online', () => {
    it('sets itself up on arrival, with nothing to agree to a second time', async () => {
      offer({ required: true });

      await waitFor(() => expect(screen.getByRole('link', { name: /Approve/i })).toBeTruthy());
      expect(gateway).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: /Set up/i })).toBeNull();
    });

    it('names the day the first payment lands, so a wrong date is caught here', async () => {
      offer({ required: true });

      await waitFor(() => expect(screen.getByText(/1 Dec 2026/i)).toBeTruthy());
    });

    /**
     * The bank's authorisation is not ours to give. A member whose UPI app will not open
     * must not be stranded at a reception desk with a queue behind them — and nothing is
     * lost, because the desk sets the same mandate up when it approves them.
     */
    it('lets the member finish at the desk, and then says no more about it', async () => {
      const deferred = vi.fn();
      offer({ required: true, onDeferred: deferred });
      await waitFor(() => expect(screen.getByRole('link', { name: /Approve/i })).toBeTruthy());

      await userEvent.click(screen.getByRole('button', { name: /at the desk/i }));

      expect(deferred).toHaveBeenCalled();
      expect(screen.queryByRole('link', { name: /Approve/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Set up/i })).toBeNull();
    });

    it('offers another go rather than a dead end when the gateway refuses', async () => {
      gateway.mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });
      offer({ required: true });

      await waitFor(() => expect(screen.getByRole('button', { name: /Try again/i })).toBeTruthy());

      gateway.mockResolvedValue({ ok: true, json: () => Promise.resolve(MANDATE) });
      await userEvent.click(screen.getByRole('button', { name: /Try again/i }));

      await waitFor(() => expect(screen.getByRole('link', { name: /Approve/i })).toBeTruthy());
    });
  });
});
