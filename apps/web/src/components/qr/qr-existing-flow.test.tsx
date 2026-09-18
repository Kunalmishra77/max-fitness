import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelfieCaptureProps } from '@/components/join/selfie-capture';
import { WithIntl } from '@/test/intl';
import { QrExistingFlow, type QrSubmitResult } from './qr-existing-flow';

/**
 * "I'm already a member" after scanning the reception QR (qr-onboarding-flow §3; ADR-058).
 *
 * One question per screen, big targets, the month-end date required. The member's
 * answers and selfie go to the server in one request; the reference code comes back
 * for the member to show at the desk.
 */

const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });

function FakeCamera({ open, onCaptured, onOpenChange }: SelfieCaptureProps) {
  if (!open) return null;
  return (
    <button
      type="button"
      onClick={() => {
        onCaptured(photo);
        onOpenChange(false);
      }}
    >
      fake camera
    </button>
  );
}

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:qr-selfie'), revokeObjectURL: vi.fn() }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function renderFlow(result: QrSubmitResult = { ok: true, referenceCode: 'Q-4821' }) {
  const submit = vi.fn<(form: FormData) => Promise<QrSubmitResult>>().mockResolvedValue(result);
  const onSubmitted = vi.fn();
  render(
    <WithIntl>
      <QrExistingFlow
        today="2026-09-17"
        minAge={16}
        noticeVersion="1.0"
        termsHref="/legal/terms"
        privacyHref="/legal/privacy"
        submit={submit}
        onSubmitted={onSubmitted}
        Camera={FakeCamera}
      />
    </WithIntl>,
  );
  return { submit, onSubmitted, user: userEvent.setup() };
}

async function answerAll(user: ReturnType<typeof userEvent.setup>, options: { plan?: string; amount?: string } = {}) {
  const next = () => user.click(screen.getByRole('button', { name: 'Next' }));
  await user.type(screen.getByLabelText('Mobile number'), '9876543210');
  await next();
  await user.type(screen.getByLabelText('Full name'), 'Sanjay Tomar');
  await next();
  await user.click(screen.getByRole('button', { name: 'Man' }));
  await next();
  await user.type(screen.getByLabelText('Day'), '14');
  await user.type(screen.getByLabelText('Month'), '02');
  await user.type(screen.getByLabelText('Year'), '1984');
  await next();
  await user.click(screen.getByRole('button', { name: 'Take selfie' }));
  await user.click(screen.getByRole('button', { name: 'fake camera' }));
  await next();
  await user.click(screen.getByRole('button', { name: options.plan ?? '3 months' }));
  await next();
  fireEvent.change(screen.getByLabelText('Fees paid until'), { target: { value: '2026-09-30' } });
  await next();
  if (options.amount !== undefined) await user.type(screen.getByLabelText('Amount in rupees (optional)'), options.amount);
  await next();
  await user.click(screen.getByText('I agree to the Terms of membership and Privacy policy.'));
  await user.click(screen.getByRole('button', { name: 'Send to reception' }));
}

describe('QrExistingFlow', () => {
  it('asks one question at a time and sends the month-end date with the details and selfie', async () => {
    const { submit, onSubmitted, user } = renderFlow();
    expect(screen.getByText('Question 1 of 9')).toBeTruthy();

    await answerAll(user, { amount: '4000' });

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const sent = submit.mock.calls[0]?.[0];
    expect(Object.fromEntries([...(sent?.entries() ?? [])].filter(([, v]) => typeof v === 'string'))).toMatchObject({
      mobile: '9876543210',
      fullName: 'Sanjay Tomar',
      gender: 'MALE',
      dob: '1984-02-14',
      declaredPlanMonths: '3',
      declaredEndDate: '2026-09-30',
      declaredAmount: '4000',
      noticeVersion: '1.0',
    });
    expect(JSON.parse(sent?.get('consents') as string)).toMatchObject({ terms: true, privacy: true });
    expect((sent?.get('selfie') as Blob | null)?.size).toBe(photo.size);
    expect(onSubmitted).toHaveBeenCalledWith('Q-4821');
  });

  it('will not move on from the month-end step without a date, and limits the calendar to the allowed range', async () => {
    const { user } = renderFlow();
    const next = () => user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText('Mobile number'), '9876543210');
    await next();
    await user.type(screen.getByLabelText('Full name'), 'Sanjay Tomar');
    await next();
    await user.click(screen.getByRole('button', { name: 'Man' }));
    await next();
    await user.type(screen.getByLabelText('Day'), '14');
    await user.type(screen.getByLabelText('Month'), '02');
    await user.type(screen.getByLabelText('Year'), '1984');
    await next();
    // The selfie is required: without it the step does not move on.
    await next();
    expect(screen.getByRole('button', { name: 'Take selfie' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Take selfie' }));
    await user.click(screen.getByRole('button', { name: 'fake camera' }));
    await next();
    await user.click(screen.getByRole('button', { name: 'Not sure' }));
    await next();

    const date = screen.getByLabelText('Fees paid until');
    expect(date.getAttribute('min')).toBe('2026-07-19');
    expect(date.getAttribute('max')).toBe('2027-10-17');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Next' }).disabled).toBe(true);
  });

  it('sends an unsure plan and no amount as blanks', async () => {
    const { submit, user } = renderFlow();
    await answerAll(user, { plan: 'Not sure' });
    await waitFor(() => expect(submit).toHaveBeenCalled());
    const sent = submit.mock.calls[0]?.[0];
    expect(sent?.get('declaredPlanMonths')).toBe('');
    expect(sent?.get('declaredAmount')).toBe('');
  });

  it('goes back to the month-end step when the server refuses the date', async () => {
    const { user } = renderFlow({ ok: false, code: 'VALIDATION_FAILED', fields: ['declaredEndDate'] });
    await answerAll(user);

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Choose a date from the last two months up to a year ahead.');
    expect(screen.getByLabelText('Fees paid until')).toBeTruthy();
  });
});
