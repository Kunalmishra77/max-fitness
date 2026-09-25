import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WithIntl } from '@/test/intl';
import { AnnouncementComposer, type AnnouncementActionResult, type AnnouncementInput } from './announcement-composer';

/**
 * "Kal gym band rahega" — the owner writes it once (ADR-079).
 *
 * The one screen that messages every member, so it says how many phones before it
 * touches any of them, makes the owner confirm, and never sends twice on a double tap.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const ok: AnnouncementActionResult = { ok: true, queued: 182, skipped: { noOptIn: 12, unsubscribed: 3, noMobile: 1 } };

function composer(result: AnnouncementActionResult = ok, reach = { reachable: 182, total: 198 }) {
  const send = vi.fn<(input: AnnouncementInput) => Promise<AnnouncementActionResult>>().mockResolvedValue(result);
  const unlock = vi.fn().mockResolvedValue({ ok: true });
  render(
    <WithIntl>
      <AnnouncementComposer reach={reach} send={send} unlock={unlock} />
    </WithIntl>,
  );
  return { send, unlock, user: userEvent.setup() };
}

const write = async (user: ReturnType<typeof userEvent.setup>, text = 'कल दिवाली के कारण जिम बंद रहेगा।') => {
  await user.type(screen.getByLabelText(/Hindi/i), text);
};

describe('AnnouncementComposer', () => {
  it('says how many members it will reach, and how many it cannot, before anything is sent', () => {
    composer();

    // 182 of 198 — the gap is the whole point: the owner should not think it went to all.
    expect(screen.getByText(/182/)).toBeTruthy();
    expect(screen.getByText(/198/)).toBeTruthy();
  });

  it('will not send an empty announcement', async () => {
    const { send, user } = composer();

    await user.click(screen.getByRole('button', { name: /Send to members/i }));

    expect(send).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('asks to confirm, then sends what was written and reports who got it', async () => {
    const { send, user } = composer();

    await write(user);
    await user.click(screen.getByRole('button', { name: /Send to members/i }));

    // Nothing has gone yet: the confirmation is the point.
    expect(send).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Yes, send it/i }));

    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send.mock.calls[0]?.[0]).toEqual({ textEn: '', textHi: 'कल दिवाली के कारण जिम बंद रहेगा।', audience: 'ACTIVE' });
    // The owner is told what happened, including the sixteen who could not be reached.
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('182');
    expect(status.textContent).toContain('16');
  });

  it('cannot be sent twice by a second tap', async () => {
    let release: (value: AnnouncementActionResult) => void = () => {};
    const send = vi.fn<(input: AnnouncementInput) => Promise<AnnouncementActionResult>>(
      () => new Promise((resolve) => { release = resolve; }),
    );
    render(
      <WithIntl>
        <AnnouncementComposer reach={{ reachable: 5, total: 5 }} send={send} unlock={vi.fn().mockResolvedValue({ ok: true })} />
      </WithIntl>,
    );
    const user = userEvent.setup();

    await write(user);
    await user.click(screen.getByRole('button', { name: /Send to members/i }));
    const confirm = screen.getByRole('button', { name: /Yes, send it/i });
    await user.click(confirm);
    await user.click(confirm).catch(() => {});

    expect(send).toHaveBeenCalledOnce();
    release(ok);
  });

  it('asks for the PIN again and then sends the announcement it was holding', async () => {
    const send = vi
      .fn<(input: AnnouncementInput) => Promise<AnnouncementActionResult>>()
      .mockResolvedValueOnce({ ok: false, code: 'PIN_REQUIRED' })
      .mockResolvedValueOnce(ok);
    const unlock = vi.fn().mockResolvedValue({ ok: true });
    render(
      <WithIntl>
        <AnnouncementComposer reach={{ reachable: 182, total: 198 }} send={send} unlock={unlock} />
      </WithIntl>,
    );
    const user = userEvent.setup();

    await write(user);
    await user.click(screen.getByRole('button', { name: /Send to members/i }));
    await user.click(screen.getByRole('button', { name: /Yes, send it/i }));

    await user.type(await screen.findByLabelText('PIN'), '2468');
    await user.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(unlock).toHaveBeenCalledWith('2468');
  });

  it('explains the two refusals that are about timing, not about the words', async () => {
    const { user } = composer({ ok: false, code: 'QUIET_HOURS', start: '08:00', end: '21:00' });

    await write(user);
    await user.click(screen.getByRole('button', { name: /Send to members/i }));
    await user.click(screen.getByRole('button', { name: /Yes, send it/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('08:00');
    expect(alert.textContent).toContain('21:00');
  });

  it('says plainly when the gym has automatic messages switched off', async () => {
    const { user } = composer({ ok: false, code: 'PAUSED' });

    await write(user);
    await user.click(screen.getByRole('button', { name: /Send to members/i }));
    await user.click(screen.getByRole('button', { name: /Yes, send it/i }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/switched off|band/i);
  });
});
