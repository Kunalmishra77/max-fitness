import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WithIntl } from '@/test/intl';
import { QrExistingForm, type QrSubmit } from './qr-existing-form';

/**
 * "I am already a member", on one page (client decision, ADR-075).
 *
 * It used to be nine questions, one per screen. A member standing at reception with a
 * queue behind them wants to see the whole thing, fill it, and press send — and when
 * something is wrong they want to be told *which answer*, next to that answer, not
 * "that could not be sent" on a screen that shows none of them.
 */

const ok: QrSubmit = () => Promise.resolve({ ok: true, referenceCode: 'Q-4821' });

function form(over: { submit?: QrSubmit; onDone?: (code: string) => void } = {}) {
  const onDone = over.onDone ?? vi.fn();
  render(
    <WithIntl>
      <QrExistingForm
        today="2026-09-24"
        minAge={16}
        noticeVersion="1.0"
        termsHref="/legal/terms"
        privacyHref="/legal/privacy"
        submit={over.submit ?? ok}
        onSubmitted={onDone}
        Camera={({ open, onCaptured }) =>
          open ? (
            <button type="button" onClick={() => onCaptured(new Blob(['x'], { type: 'image/jpeg' }))}>
              Take the photo
            </button>
          ) : null
        }
      />
    </WithIntl>,
  );
  return { onDone };
}

/** A date input takes a value, not keystrokes. */
const setDate = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** Fill everything the gym insists on, leaving the optional answers alone. */
async function fillRequired() {
  await userEvent.type(screen.getByLabelText(/Full name/i), 'Sanjay Tomar');
  await userEvent.type(screen.getByLabelText(/Mobile number/i), '9876543210');
  setDate(/Date of birth/i, '1992-05-14');
  await userEvent.click(screen.getByRole('radio', { name: /^Male$/i }));
  // The sheet opens first, then the camera inside it hands back a photo.
  await userEvent.click(screen.getByRole('button', { name: /Take your photo/i }));
  await userEvent.click(screen.getByRole('button', { name: /Take the photo/i }));
  await userEvent.click(screen.getByRole('radio', { name: /3 months/i }));
  setDate(/Fees paid until/i, '2026-11-30');
  await userEvent.selectOptions(screen.getByLabelText(/Which ID/i), 'AADHAAR');
  const card = (name: string) => new File(['card'], name, { type: 'image/jpeg' });
  await userEvent.upload(screen.getByLabelText(/front/i), card('front.jpg'));
  await userEvent.upload(screen.getByLabelText(/back/i), card('back.jpg'));
  await userEvent.click(screen.getByRole('checkbox', { name: /Terms/i }));
}

describe('QrExistingForm', () => {
  it('shows every question at once, not one at a time', () => {
    form();

    // The things that used to be nine separate screens.
    expect(screen.getByLabelText(/Full name/i)).toBeTruthy();
    expect(screen.getByLabelText(/Mobile number/i)).toBeTruthy();
    expect(screen.getByLabelText(/Date of birth/i)).toBeTruthy();
    expect(screen.getByLabelText(/Fees paid until/i)).toBeTruthy();
    expect(screen.queryByText(/Question \d of \d/i)).toBeNull();
  });

  it('marks the two optional answers as optional, and nothing else', () => {
    form();

    expect(screen.getByLabelText(/Joining date/i).getAttribute('aria-required')).not.toBe('true');
    expect(screen.getByLabelText(/Email/i).getAttribute('aria-required')).not.toBe('true');
    expect(screen.getByLabelText(/Full name/i).getAttribute('aria-required')).toBe('true');
    expect(screen.getByLabelText(/Fees paid until/i).getAttribute('aria-required')).toBe('true');
  });

  it('sends everything the member filled in, once', async () => {
    const submit = vi.fn<QrSubmit>().mockResolvedValue({ ok: true, referenceCode: 'Q-4821' });
    const { onDone } = form({ submit });

    await fillRequired();
    setDate(/Joining date/i, '2019-04-15');
    await userEvent.type(screen.getByLabelText(/Email/i), 'sanjay@example.com');
    await userEvent.click(screen.getByRole('button', { name: /Send to reception/i }));

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const sent = submit.mock.calls[0]?.[0] as FormData;
    expect(sent.get('fullName')).toBe('Sanjay Tomar');
    expect(sent.get('mobile')).toBe('9876543210');
    expect(sent.get('joinedOn')).toBe('2019-04-15');
    expect(sent.get('email')).toBe('sanjay@example.com');
    expect(sent.get('govIdType')).toBe('AADHAAR');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Q-4821'));
  });

  it('will not send until the answers the gym insists on are there', async () => {
    const submit = vi.fn<QrSubmit>().mockResolvedValue({ ok: true, referenceCode: 'Q-1' });
    form({ submit });

    await userEvent.click(screen.getByRole('button', { name: /Send to reception/i }));

    expect(submit).not.toHaveBeenCalled();
    // Told what is missing, on the page, rather than "that could not be sent".
    expect(await screen.findByText(/Please fill/i)).toBeTruthy();
  });

  it('puts the server’s complaint next to the answer it is about', async () => {
    const submit: QrSubmit = () => Promise.resolve({ ok: false, code: 'VALIDATION_FAILED', fields: ['declaredEndDate'] });
    form({ submit });

    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: /Send to reception/i }));

    // The message belongs beside the date, not in a box at the bottom of nowhere.
    const group = screen.getByLabelText(/Fees paid until/i).closest('label');
    await waitFor(() => expect(within(group as HTMLElement).getByRole('alert')).toBeTruthy());
  });

  it('says what actually went wrong when the server fails, and keeps the answers', async () => {
    const submit: QrSubmit = () => Promise.resolve({ ok: false, code: 'INTERNAL', requestId: 'req_abc123' });
    form({ submit });

    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: /Send to reception/i }));

    // A reference the gym can quote, rather than a dead end.
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((alert) => alert.textContent?.includes('req_abc123'))).toBe(true);
    // Nothing the member typed is thrown away by a failure.
    expect(screen.getByLabelText<HTMLInputElement>(/Full name/i).value).toBe('Sanjay Tomar');
  });

  it('asks for both sides of an Aadhaar and only the front of a PAN', async () => {
    form();

    await userEvent.selectOptions(screen.getByLabelText(/Which ID/i), 'AADHAAR');
    expect(screen.getByLabelText(/front/i)).toBeTruthy();
    expect(screen.getByLabelText(/back/i)).toBeTruthy();

    await userEvent.selectOptions(screen.getByLabelText(/Which ID/i), 'PAN');
    expect(screen.getByLabelText(/front/i)).toBeTruthy();
    expect(screen.queryByLabelText(/back/i)).toBeNull();
  });

  it('never asks for the ID number, and says so', async () => {
    form();

    await userEvent.selectOptions(screen.getByLabelText(/Which ID/i), 'AADHAAR');

    // The only ID inputs are the two photographs.
    const idInputs = screen.getAllByLabelText(/front|back/i);
    expect(idInputs.every((input) => (input as HTMLInputElement).type === 'file')).toBe(true);
    expect(screen.queryByLabelText(/Aadhaar number|ID number|PAN number/i)).toBeNull();
    // And the member is told, because "why do they want my Aadhaar" deserves an answer.
    expect(screen.getByText(/never store the number/i)).toBeTruthy();
  });
});
