import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WithIntl } from '@/test/intl';
import { BirthdayList, type BirthdayItem } from './birthday-list';

/**
 * Today's birthdays on the home screen (BR-8.2).
 *
 * The wish is a tap, never automatic, so the list has to make three things obvious:
 * whose birthday it is, whether a wish can be sent, and whether one already has been.
 */

const item = (over: Partial<BirthdayItem> = {}): BirthdayItem => ({
  memberId: 'mem_1',
  fullName: 'Anita Rao',
  memberCode: 'MF-0231',
  canWish: true,
  wish: 'none',
  ...over,
});

const ok = () => vi.fn().mockResolvedValue({ ok: true });

describe('BirthdayList', () => {
  it('says so plainly when nobody has a birthday today', () => {
    render(
      <WithIntl>
        <BirthdayList items={[]} canSend onSend={ok()} />
      </WithIntl>,
    );

    expect(screen.getByText('No birthdays today')).toBeTruthy();
  });

  it('offers a wish, and says it is sent once it has been', async () => {
    const onSend = ok();
    render(
      <WithIntl>
        <BirthdayList items={[item()]} canSend onSend={onSend} />
      </WithIntl>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Send wish' }));

    expect(onSend).toHaveBeenCalledWith('mem_1');
    // Queued, not sent: the worker has not had it yet, and in a demo it never will.
    await waitFor(() => expect(screen.getByText('Wish on its way')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Send wish' })).toBeNull();
  });

  it('shows a wish already sent today without offering it again', () => {
    render(
      <WithIntl>
        <BirthdayList items={[item({ wish: 'sent' })]} canSend onSend={ok()} />
      </WithIntl>,
    );

    expect(screen.getByText('Wish sent')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send wish' })).toBeNull();
  });

  it('shows a wish still on its way as on its way, not as sent', () => {
    render(
      <WithIntl>
        <BirthdayList items={[item({ wish: 'queued' })]} canSend onSend={ok()} />
      </WithIntl>,
    );

    expect(screen.getByText('Wish on its way')).toBeTruthy();
    expect(screen.queryByText('Wish sent')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send wish' })).toBeNull();
  });

  it('explains, rather than hides, a member who cannot be messaged', () => {
    render(
      <WithIntl>
        <BirthdayList items={[item({ canWish: false })]} canSend onSend={ok()} />
      </WithIntl>,
    );

    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Anita Rao')).toBeTruthy();
    expect(within(row).getByText('Not on WhatsApp')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send wish' })).toBeNull();
  });

  it('shows the names but no button to someone who may not send', () => {
    render(
      <WithIntl>
        <BirthdayList items={[item()]} canSend={false} onSend={ok()} />
      </WithIntl>,
    );

    expect(screen.getByText('Anita Rao')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send wish' })).toBeNull();
  });

  it('puts the button back when the send fails, so it can be tried again', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: false, code: 'generic' });
    render(
      <WithIntl>
        <BirthdayList items={[item()]} canSend onSend={onSend} />
      </WithIntl>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Send wish' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Send wish' })).toBeTruthy();
  });
});
