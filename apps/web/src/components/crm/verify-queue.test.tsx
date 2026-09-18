import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WithIntl } from '@/test/intl';
import { VerifyQueue, type VerifyItem, type VerifyResult } from './verify-queue';

/**
 * "जाँचें" — the verify queue (crm-ux-blueprint §9; ADR-058).
 *
 * One card per submission: the member's photo and name, the reference to compare with
 * the one they show, and the month-end date they gave, large. When the paper register
 * has them, both dates stand side by side and the register's is chosen. Approve, change
 * the date, or reject with a reason.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const fresh: VerifyItem = {
  id: 'ver_1',
  referenceCode: 'Q-4821',
  fullName: 'Suresh Yadav',
  mobileMasked: '98xxxx4521',
  photoUrl: '/api/v1/files?key=x',
  planMonths: 3,
  declaredEndDate: '2026-09-30',
  declaredAmountPaise: 400_000,
  register: null,
};
const matched: VerifyItem = { ...fresh, id: 'ver_2', referenceCode: 'Q-1234', fullName: 'Rekha Tomar', register: { endDate: '2026-09-28', planMonths: 3 } };

function renderQueue(items: VerifyItem[], result: VerifyResult = { ok: true }) {
  const approve = vi.fn<(id: string, change: { approvedEndDate?: string; planMonths?: number }) => Promise<VerifyResult>>().mockResolvedValue(result);
  const reject = vi.fn<(id: string, reason: string) => Promise<VerifyResult>>().mockResolvedValue(result);
  render(
    <WithIntl>
      <VerifyQueue items={items} approve={approve} reject={reject} />
    </WithIntl>,
  );
  return { approve, reject, user: userEvent.setup() };
}

describe('VerifyQueue', () => {
  it('shows who it is, the reference to compare and the date they gave, and approves it as given', async () => {
    const { approve, user } = renderQueue([fresh]);
    const card = screen.getByRole('article', { name: 'Suresh Yadav' });

    expect(within(card).getByText('Q-4821')).toBeTruthy();
    expect(within(card).getByText('98xxxx4521')).toBeTruthy();
    expect(within(card).getByText('30 Sep 2026')).toBeTruthy();
    expect(within(card).getByText('₹4,000')).toBeTruthy();
    expect(within(card).getByRole('img', { name: 'Suresh Yadav' }).getAttribute('src')).toBe('/api/v1/files?key=x');

    await user.click(within(card).getByRole('button', { name: 'Correct' }));

    await waitFor(() => expect(approve).toHaveBeenCalledWith('ver_1', { approvedEndDate: '2026-09-30' }));
    expect(await screen.findByText('Approved — the membership is on.')).toBeTruthy();
  });

  it('keeps a decided card with its outcome when the refreshed list no longer has it', async () => {
    const approve = vi.fn<(id: string, change: { approvedEndDate?: string }) => Promise<VerifyResult>>().mockResolvedValue({ ok: true });
    const reject = vi.fn<(id: string, reason: string) => Promise<VerifyResult>>().mockResolvedValue({ ok: true });
    const view = (items: VerifyItem[]) => (
      <WithIntl>
        <VerifyQueue items={items} approve={approve} reject={reject} />
      </WithIntl>
    );
    const { rerender } = render(view([fresh, matched]));
    const user = userEvent.setup();

    await user.click(within(screen.getByRole('article', { name: 'Suresh Yadav' })).getByRole('button', { name: 'Correct' }));
    await screen.findByText('Approved — the membership is on.');
    // The server list after the refresh: the approved request is gone from it.
    rerender(view([matched]));

    expect(within(screen.getByRole('article', { name: 'Suresh Yadav' })).getByRole('status').textContent).toBe('Approved — the membership is on.');
    expect(screen.getByRole('article', { name: 'Rekha Tomar' })).toBeTruthy();
  });

  it('puts the register date beside the member’s, and chooses the register’s', async () => {
    const { approve, user } = renderQueue([matched]);
    const card = screen.getByRole('article', { name: 'Rekha Tomar' });

    const register = within(card).getByRole('radio', { name: /In the register: 28 Sep 2026/ });
    const told = within(card).getByRole('radio', { name: /Member said: 30 Sep 2026/ });
    expect((register as HTMLInputElement).checked).toBe(true);
    expect((told as HTMLInputElement).checked).toBe(false);

    await user.click(within(card).getByRole('button', { name: 'Correct' }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith('ver_2', { approvedEndDate: '2026-09-28' }));
  });

  it('lets staff change the date before approving', async () => {
    const { approve, user } = renderQueue([fresh]);
    const card = screen.getByRole('article', { name: 'Suresh Yadav' });

    await user.click(within(card).getByRole('button', { name: 'Change date' }));
    fireEvent.change(within(card).getByLabelText('Fees paid until'), { target: { value: '2026-09-25' } });
    await user.click(within(card).getByRole('button', { name: 'Approve with this date' }));

    await waitFor(() => expect(approve).toHaveBeenCalledWith('ver_1', { approvedEndDate: '2026-09-25' }));
  });

  it('rejects only with a reason', async () => {
    const { reject, user } = renderQueue([fresh]);
    const card = screen.getByRole('article', { name: 'Suresh Yadav' });

    await user.click(within(card).getByRole('button', { name: 'Not right' }));
    const confirm = within(card).getByRole('button', { name: 'Reject' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await user.type(within(card).getByLabelText('Why?'), 'Not in the register');
    await user.click(confirm);

    await waitFor(() => expect(reject).toHaveBeenCalledWith('ver_1', 'Not in the register'));
    expect(await screen.findByText('Rejected.')).toBeTruthy();
  });

  it('says so when there is nothing to check', () => {
    renderQueue([]);
    expect(screen.getByText('Nothing to check right now.')).toBeTruthy();
  });
});
