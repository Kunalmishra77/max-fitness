import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WithIntl } from '@/test/intl';
import { RemindersForm } from './settings-forms';

/**
 * The reminder times, and the warning that keeps ADR-068 from being undone.
 *
 * A rule with three times a day and a seven-day window sends one member 21 messages.
 * That is exactly the shape the simulator caught, and this screen is the one place it
 * could come back — so the screen says the number out loud rather than letting the
 * owner discover it on a member's phone.
 */

const save = () => vi.fn().mockResolvedValue({ ok: true });
const unlock = () => vi.fn().mockResolvedValue({ ok: true });

function form(slots: string[], postExpiryMaxDays = 7) {
  return render(
    <WithIntl>
      <RemindersForm
        rules={[{ code: 'POST', slots, isEnabled: true }]}
        postExpiryMaxDays={postExpiryMaxDays}
        quietHours={{ start: '08:00', end: '21:00' }}
        save={save()}
        unlock={unlock()}
      />
    </WithIntl>,
  );
}

describe('RemindersForm', () => {
  it('says nothing extra about a rule that sends once a day', () => {
    form(['19:00']);

    expect(screen.queryByText(/messages to one member/i)).toBeNull();
  });

  it('counts out loud what several times a day comes to', () => {
    form(['09:30', '14:00', '19:00']);

    // Three a day across a seven-day window is 21 messages to one lapsed member.
    expect(screen.getByText(/21 messages to one member/i)).toBeTruthy();
  });

  it('updates the count as a time is added', async () => {
    form(['19:00']);

    await userEvent.click(screen.getByRole('button', { name: /add/i }));

    expect(screen.getByText(/14 messages to one member/i)).toBeTruthy();
  });

  it('counts a single-day rule as the one message it is', () => {
    render(
      <WithIntl>
        <RemindersForm
          rules={[{ code: 'PRE_7', slots: ['10:00', '18:00'], isEnabled: true }]}
          postExpiryMaxDays={7}
          quietHours={{ start: '08:00', end: '21:00' }}
          save={save()}
          unlock={unlock()}
        />
      </WithIntl>,
    );

    // PRE_7 fires on one day only, so two times a day is two messages, not fourteen.
    expect(screen.getByText(/2 messages to one member/i)).toBeTruthy();
  });
});
