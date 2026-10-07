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
        // The real one needs a canvas; what matters here is that something smaller is sent.
        shrinkId={(file) => Promise.resolve(new Blob([`small:${file.name}`], { type: 'image/jpeg' }))}
      />
    </WithIntl>,
  );
  return { onDone, user: userEvent.setup() };
}

/** A date input takes a value, not keystrokes. */
const setDate = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** Move to the next question. */
const next = () => userEvent.click(screen.getByRole('button', { name: /Next/i }));

/** Walk forward to a named screen, answering only what each one insists on. */
async function walkTo(stop: 'dob' | 'selfie' | 'plan' | 'payMethod' | 'slot' | 'govId' | 'optional' | 'consent') {
  await userEvent.type(screen.getByLabelText(/Full name/i), 'Sanjay Tomar');
  await userEvent.type(screen.getByLabelText(/Mobile number/i), '9876543210');
  await next();
  if (stop === 'dob') return;

  setDate(/Date of birth/i, '1992-05-14');
  await userEvent.click(screen.getByRole('radio', { name: /^Male$/i }));
  await next();
  if (stop === 'selfie') return;

  await userEvent.click(screen.getByRole('button', { name: /Take your photo/i }));
  await userEvent.click(screen.getByRole('button', { name: /Take the photo/i }));
  await next();
  if (stop === 'plan') return;

  await userEvent.click(screen.getByRole('radio', { name: /3 Months/i }));
  setDate(/Fees paid until/i, '2026-11-30');
  await next();
  if (stop === 'payMethod') return;

  await userEvent.click(screen.getByRole('radio', { name: /Cash at the counter/i }));
  await next();
  if (stop === 'slot') return;

  await userEvent.click(screen.getByRole('radio', { name: /^Morning$/i }));
  await next();
  if (stop === 'govId') return;

  await userEvent.selectOptions(screen.getByLabelText(/Upload a Govt ID/i), 'AADHAAR');
  const card = (name: string) => new File(['card'], name, { type: 'image/jpeg' });
  await userEvent.upload(screen.getByLabelText(/Front of the card/i), card('front.jpg'));
  await userEvent.upload(screen.getByLabelText(/Back of the card/i), card('back.jpg'));
  await next();
  if (stop === 'optional') return;

  await next();
}

/** Walk every question the gym insists on, leaving the optional ones alone. */
async function fillRequired(optional: { email?: string; joinedOn?: string } = {}) {
  await walkTo('optional');
  if (optional.joinedOn !== undefined) setDate(/Joining date/i, optional.joinedOn);
  if (optional.email !== undefined) await userEvent.type(screen.getByLabelText(/Email/i), optional.email);
  await next();
  await userEvent.click(screen.getByRole('checkbox', { name: /Terms/i }));
}


describe('QrExistingForm', () => {
  it('asks one thing at a time, and says where the member is', () => {
    // The gym watched members use the single long page and asked for this back: on a
    // phone at reception, one question on the screen beats eleven (ADR-080).
    form();

    expect(screen.getByLabelText(/Full name/i)).toBeTruthy();
    expect(screen.getByLabelText(/Mobile number/i)).toBeTruthy();
    // Later questions are not on this screen yet.
    expect(screen.queryByLabelText(/Fees paid until/i)).toBeNull();
    expect(screen.queryByLabelText(/Upload a Govt ID/i)).toBeNull();
    expect(screen.getByText(/1 \/ \d/)).toBeTruthy();
  });

  it('will not move on until the question on the screen is answered, and goes back', async () => {
    const { user } = form();

    await user.click(screen.getByRole('button', { name: /Next/i }));
    expect(await screen.findByText(/Please write your full name/i)).toBeTruthy();
    expect(screen.getByLabelText(/Full name/i)).toBeTruthy();

    await user.type(screen.getByLabelText(/Full name/i), 'Sanjay Tomar');
    await user.type(screen.getByLabelText(/Mobile number/i), '9876543210');
    await user.click(screen.getByRole('button', { name: /Next/i }));

    expect(screen.getByLabelText(/Date of birth/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Back/i }));
    // Nothing typed is lost by stepping back.
    expect(screen.getByLabelText<HTMLInputElement>(/Full name/i).value).toBe('Sanjay Tomar');
  });

  it('marks the two optional answers as optional, and the required ones required', async () => {
    form();

    expect(screen.getByLabelText(/Full name/i).getAttribute('aria-required')).toBe('true');
    await walkTo('optional');
    expect(screen.getByLabelText(/Joining date/i).getAttribute('aria-required')).not.toBe('true');
    expect(screen.getByLabelText(/Email/i).getAttribute('aria-required')).not.toBe('true');
  });

  it('sends everything the member filled in, once', async () => {
    const submit = vi.fn<QrSubmit>().mockResolvedValue({ ok: true, referenceCode: 'Q-4821' });
    const { onDone } = form({ submit });

    await fillRequired({ email: 'sanjay@example.com', joinedOn: '2019-04-15' });
    await userEvent.click(screen.getByRole('button', { name: /Send to reception/i }));

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const sent = submit.mock.calls[0]?.[0] as FormData;
    expect(sent.get('fullName')).toBe('Sanjay Tomar');
    expect(sent.get('mobile')).toBe('9876543210');
    expect(sent.get('joinedOn')).toBe('2019-04-15');
    expect(sent.get('email')).toBe('sanjay@example.com');
    expect(sent.get('govIdType')).toBe('AADHAAR');
    // The gym shuts at midday, so when a member comes is worth knowing (ADR-082).
    expect(sent.get('trainingSlot')).toBe('MORNING');
    // The second argument is the autopay hand-over, absent for a member paying cash.
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Q-4821', undefined));
  });

  it('will not send until the last question is answered either', async () => {
    const submit = vi.fn<QrSubmit>().mockResolvedValue({ ok: true, referenceCode: 'Q-1' });
    form({ submit });

    await walkTo('consent');
    await userEvent.click(screen.getByRole('button', { name: /Send to reception/i }));

    expect(submit).not.toHaveBeenCalled();
    // Told what is missing, where they are, rather than "that could not be sent".
    expect((await screen.findAllByRole('alert')).some((alert) => /agree to the terms/i.test(alert.textContent ?? ''))).toBe(true);
  });

  it('puts the server’s complaint next to the answer it is about', async () => {
    const submit: QrSubmit = () => Promise.resolve({ ok: false, code: 'VALIDATION_FAILED', fields: ['declaredEndDate'] });
    form({ submit });

    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: /Send to reception/i }));

    // The member is taken back to the screen holding that answer, with the message on it.
    const date = await screen.findByLabelText(/Fees paid until/i);
    await waitFor(() => expect(within(date.closest('label') as HTMLElement).getByRole('alert')).toBeTruthy());
  });

  it('says what actually went wrong when the server fails, and keeps the answers', async () => {
    const submit: QrSubmit = () => Promise.resolve({ ok: false, code: 'INTERNAL', requestId: 'req_abc123' });
    form({ submit });

    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: /Send to reception/i }));

    // A reference the gym can quote, rather than a dead end.
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((alert) => alert.textContent?.includes('req_abc123'))).toBe(true);
    // Nothing the member answered is thrown away by a failure — they are still here,
    // with the box they ticked still ticked, and can simply press send again.
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /Terms/i }).checked).toBe(true);
    expect(screen.getByRole('button', { name: /Send to reception/i })).toBeTruthy();
  });

  it('sends the shrunk card, not the four-megabyte one the phone took', async () => {
    // A raw photo of an Aadhaar is several megabytes; a selfie and two of them were more
    // than the request could carry, and reception met "HTTP 413" (ADR-080).
    const submit = vi.fn<QrSubmit>().mockResolvedValue({ ok: true, referenceCode: 'Q-9' });
    form({ submit });

    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: /Send to reception/i }));

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const sent = submit.mock.calls[0]?.[0] as FormData;
    expect(await (sent.get('govIdFront') as Blob).text()).toBe('small:front.jpg');
    expect(await (sent.get('govIdBack') as Blob).text()).toBe('small:back.jpg');
  });

  it('refuses a photo too large to arrive instead of letting the member hit a 413', async () => {
    // The old-phone case: the browser cannot shrink it, so we would have sent the
    // original — which the host bounces before our server ever sees it (ADR-080).
    const huge = new File([new Uint8Array(2_000_000)], 'huge.jpg', { type: 'image/jpeg' });
    render(
      <WithIntl>
        <QrExistingForm
          today="2026-09-24"
          minAge={16}
          noticeVersion="1.0"
          termsHref="/legal/terms"
          privacyHref="/legal/privacy"
          submit={ok}
          onSubmitted={vi.fn()}
          Camera={({ open, onCaptured }) =>
            open ? (
              <button type="button" onClick={() => onCaptured(new Blob(['x'], { type: 'image/jpeg' }))}>
                Take the photo
              </button>
            ) : null
          }
          shrinkId={() => Promise.reject(new Error('no canvas here'))}
        />
      </WithIntl>,
    );
    const user = userEvent.setup();

    await walkTo('govId');
    await user.selectOptions(screen.getByLabelText(/Upload a Govt ID/i), 'PAN');
    await user.upload(screen.getByLabelText(/Front of the card/i), huge);

    expect(await screen.findByText(/too large to send/i)).toBeTruthy();
  });

  it('asks for both sides of an Aadhaar and only the front of a PAN', async () => {
    form();
    await walkTo('govId');

    await userEvent.selectOptions(screen.getByLabelText(/Upload a Govt ID/i), 'AADHAAR');
    expect(screen.getByLabelText(/Front of the card/i)).toBeTruthy();
    expect(screen.getByLabelText(/Back of the card/i)).toBeTruthy();

    await userEvent.selectOptions(screen.getByLabelText(/Upload a Govt ID/i), 'PAN');
    expect(screen.getByLabelText(/Front of the card/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Back of the card/i)).toBeNull();
  });

  it('never asks for the ID number, and says so', async () => {
    form();
    await walkTo('govId');

    await userEvent.selectOptions(screen.getByLabelText(/Upload a Govt ID/i), 'AADHAAR');

    // The only ID inputs are the two photographs.
    const idInputs = screen.getAllByLabelText(/of the card/i);
    expect(idInputs.every((input) => (input as HTMLInputElement).type === 'file')).toBe(true);
    expect(screen.queryByLabelText(/Aadhaar number|ID number|PAN number/i)).toBeNull();
    // And the member is told, because "why do they want my Aadhaar" deserves an answer.
    expect(screen.getByText(/never the number/i)).toBeTruthy();
  });
});
