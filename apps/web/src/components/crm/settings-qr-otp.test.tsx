import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WithIntl } from '@/test/intl';
import { QrOtpForm } from './settings-forms';

/**
 * The QR OTP switch, which an owner must not be able to turn on right now (ADR-077).
 *
 * The server refuses a QR submission without a code whenever this is on. The reception
 * form no longer asks for one — it is one page and one Send, by the client's decision
 * (ADR-075) — and the gym has no WhatsApp number to send a code from anyway. So the
 * switch, sitting in Settings looking harmless, would stop every member at the desk.
 */

const unlock = vi.fn(() => Promise.resolve({ ok: true as const }));

function renderForm(required = false) {
  const save = vi.fn(() => Promise.resolve({ ok: true as const, changed: true }));
  render(
    <WithIntl>
      <QrOtpForm required={required} save={save} unlock={unlock} />
    </WithIntl>,
  );
  return { save, user: userEvent.setup() };
}

describe('QrOtpForm', () => {
  it('cannot be switched on, and says why', async () => {
    const { user } = renderForm();
    const box = screen.getByRole('checkbox');

    expect((box as HTMLInputElement).disabled).toBe(true);
    await user.click(box);
    expect((box as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/Not available yet/)).toBeTruthy();
  });
});
