import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WithIntl } from '@/test/intl';
import { KioskDevices, type KioskDeviceItem } from './kiosk-devices';

/**
 * The attendance phone, as the owner manages it (crm-module-spec §4; Phase 7).
 *
 * The phone is on a wall where nobody looks at it, so this card has one job: say
 * whether it is working, in words the owner can act on. "Last seen 2 hours ago" is
 * something to act on; "lastSeenAt: 2026-09-24T03:00:00Z" is not.
 */

const device = (over: Partial<KioskDeviceItem> = {}): KioskDeviceItem => ({
  id: 'kiosk_1',
  name: 'Reception phone',
  status: 'ACTIVE',
  paired: true,
  offline: false,
  shadowMode: true,
  appVersion: '1.0.0',
  lastSeenLabel: '2 minutes ago',
  health: { battery: 92, charging: true, temperatureC: 36.5, queueSize: 0, cameraOk: true },
  pairingCode: null,
  ...over,
});

const actions = () => ({
  pair: vi.fn().mockResolvedValue({ ok: true, code: '482913' }),
  revoke: vi.fn().mockResolvedValue({ ok: true }),
  setShadowMode: vi.fn().mockResolvedValue({ ok: true }),
  unlock: vi.fn().mockResolvedValue({ ok: true }),
});

describe('KioskDevices', () => {
  it('invites the owner to pair a phone when there is none', () => {
    render(
      <WithIntl>
        <KioskDevices devices={[]} {...actions()} />
      </WithIntl>,
    );

    expect(screen.getByText('No attendance phone yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pair a phone' })).toBeTruthy();
  });

  it('says the phone is working, and how it is doing', () => {
    render(
      <WithIntl>
        <KioskDevices devices={[device()]} {...actions()} />
      </WithIntl>,
    );

    const card = screen.getByRole('article', { name: 'Reception phone' });
    expect(within(card).getByText('Working')).toBeTruthy();
    expect(within(card).getByText(/2 minutes ago/)).toBeTruthy();
    expect(within(card).getByText(/92%/)).toBeTruthy();
  });

  it('says plainly when the phone has gone quiet', () => {
    render(
      <WithIntl>
        <KioskDevices devices={[device({ offline: true, lastSeenLabel: '3 hours ago' })]} {...actions()} />
      </WithIntl>,
    );

    const card = screen.getByRole('article', { name: 'Reception phone' });
    expect(within(card).getByText('Not responding')).toBeTruthy();
    expect(within(card).getByText(/3 hours ago/)).toBeTruthy();
  });

  it('warns when the camera has stopped working, which looks like nothing else', () => {
    render(
      <WithIntl>
        <KioskDevices devices={[device({ health: { battery: 90, charging: true, temperatureC: 36, queueSize: 0, cameraOk: false } })]} {...actions()} />
      </WithIntl>,
    );

    expect(screen.getByText('Camera not working')).toBeTruthy();
  });

  it('does not dress an unpaired phone as a working one', () => {
    render(
      <WithIntl>
        <KioskDevices devices={[device({ paired: false, lastSeenLabel: '2 days ago' })]} {...actions()} />
      </WithIntl>,
    );

    const card = screen.getByRole('article', { name: 'Reception phone' });
    const status = within(card).getByText('Waiting to be paired');
    // Green means "working" and red means "broken". A phone that has never finished
    // pairing is neither, and either colour would be a lie the owner acts on.
    expect(status.className).not.toContain('text-semantic-fee-paid');
    expect(status.className).not.toContain('text-semantic-fee-expired');
  });

  it('shows a pairing code once, big enough to read across a desk', async () => {
    const a = actions();
    render(
      <WithIntl>
        <KioskDevices devices={[]} {...a} />
      </WithIntl>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Pair a phone' }));

    expect(a.pair).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('482913')).toBeTruthy());
    expect(screen.getByText(/10 minutes/)).toBeTruthy();
  });

  it('says a phone in shadow mode is watching but not greeting', () => {
    render(
      <WithIntl>
        <KioskDevices devices={[device({ shadowMode: true })]} {...actions()} />
      </WithIntl>,
    );

    expect(screen.getByText('Watching only — it marks attendance but greets nobody')).toBeTruthy();
  });

  it('asks for the PIN rather than doing nothing, and then carries on', async () => {
    // Settings need a PIN entered in the last five minutes. Before this, the button
    // simply did nothing — the exact failure the keypad was fixed for.
    const a = actions();
    a.pair.mockResolvedValueOnce({ ok: false, code: 'PIN_REQUIRED' }).mockResolvedValueOnce({ ok: true, code: '482913' });
    render(
      <WithIntl>
        <KioskDevices devices={[]} {...a} />
      </WithIntl>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Pair a phone' }));

    const pin = await screen.findByLabelText('PIN');
    await userEvent.type(pin, '2468');
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    await waitFor(() => expect(a.unlock).toHaveBeenCalledWith('2468'));
    // The action the owner actually asked for is retried, not forgotten.
    await waitFor(() => expect(screen.getByText('482913')).toBeTruthy());
  });

  it('says a wrong PIN was wrong instead of failing quietly', async () => {
    const a = actions();
    a.pair.mockResolvedValue({ ok: false, code: 'PIN_REQUIRED' });
    a.unlock.mockResolvedValue({ ok: false, code: 'INVALID_PIN' });
    render(
      <WithIntl>
        <KioskDevices devices={[]} {...a} />
      </WithIntl>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Pair a phone' }));
    await userEvent.type(await screen.findByLabelText('PIN'), '1111');
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('says so when something else goes wrong, rather than looking broken', async () => {
    const a = actions();
    a.pair.mockResolvedValue({ ok: false, code: 'generic' });
    render(
      <WithIntl>
        <KioskDevices devices={[]} {...a} />
      </WithIntl>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Pair a phone' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('asks before revoking, because the phone stops working immediately', async () => {
    const a = actions();
    render(
      <WithIntl>
        <KioskDevices devices={[device()]} {...a} />
      </WithIntl>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove this phone' }));
    expect(a.revoke).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Yes, remove it' }));
    await waitFor(() => expect(a.revoke).toHaveBeenCalledWith('kiosk_1'));
  });
});
