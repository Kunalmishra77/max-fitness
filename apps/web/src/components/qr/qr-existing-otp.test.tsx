import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelfieCaptureProps } from '@/components/join/selfie-capture';
import { WithIntl } from '@/test/intl';
import { QrExistingFlow, type OtpApi, type QrSubmitResult } from './qr-existing-flow';

/**
 * The QR wizard with OTP switched on (qr-onboarding-flow §3 steps 1–1b; ADR-060).
 *
 * The number is confirmed with a code first; then, and only then, the phone may see the
 * register entries on that number and say "this is me". The token and the chosen entry
 * go with the submission so the server can check both.
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
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:qr-selfie'), revokeObjectURL: vi.fn() }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeOtp(overrides: Partial<OtpApi> = {}): OtpApi {
  return {
    send: vi.fn<OtpApi['send']>().mockResolvedValue({ ok: true, demoCode: '482913' }),
    verify: vi.fn<OtpApi['verify']>().mockResolvedValue({ ok: true, otpToken: 'tok.sig' }),
    lookup: vi
      .fn<OtpApi['lookup']>()
      .mockResolvedValue([
        { memberId: 'mem_reg', firstName: 'Sanjay', lastInitial: 'T', planMonths: 3, monthEnd: '2026-09-28' },
      ]),
    ...overrides,
  };
}

function renderFlow(otpApi: OtpApi, result: QrSubmitResult = { ok: true, referenceCode: 'Q-4821' }) {
  const submit = vi.fn<(form: FormData) => Promise<QrSubmitResult>>().mockResolvedValue(result);
  render(
    <WithIntl>
      <QrExistingFlow
        today="2026-09-17"
        minAge={16}
        noticeVersion="1.0"
        termsHref="/legal/terms"
        privacyHref="/legal/privacy"
        submit={submit}
        onSubmitted={vi.fn()}
        Camera={FakeCamera}
        otpRequired
        otpApi={otpApi}
      />
    </WithIntl>,
  );
  return { submit, user: userEvent.setup() };
}

describe('QrExistingFlow with OTP', () => {
  it('confirms the number, offers the register entry, and sends the token and the choice', async () => {
    const otp = fakeOtp();
    const { submit, user } = renderFlow(otp);
    const next = () => user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Question 1 of 11')).toBeTruthy();
    await user.type(screen.getByLabelText('Mobile number'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Send code' }));

    expect(await screen.findByText('Enter the code we sent')).toBeTruthy();
    expect(otp.send).toHaveBeenCalledWith('9876543210', 'en');
    // DEMO_MODE: the code is on screen, because nothing was sent.
    expect(screen.getByText('Demo: the code is 482913')).toBeTruthy();
    await user.type(screen.getByLabelText('6-digit code'), '482913');
    await user.click(screen.getByRole('button', { name: 'Check code' }));

    expect(await screen.findByText('Is this you?')).toBeTruthy();
    expect(otp.lookup).toHaveBeenCalledWith('9876543210', 'tok.sig');
    await user.click(screen.getByRole('button', { name: 'Sanjay T. · 3 months · until 28 Sep 2026' }));
    await next();

    // The first name is filled in from the register; the member completes it.
    expect(screen.getByLabelText<HTMLInputElement>('Full name').value).toBe('Sanjay');
    await user.type(screen.getByLabelText('Full name'), ' Tomar');
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
    await user.click(screen.getByRole('button', { name: '3 months' }));
    await next();
    fireEvent.change(screen.getByLabelText('Fees paid until'), { target: { value: '2026-09-28' } });
    await next();
    await next();
    await user.click(screen.getByText('I agree to the Terms of membership and Privacy policy.'));
    await user.click(screen.getByRole('button', { name: 'Send to reception' }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const sent = submit.mock.calls[0]?.[0];
    expect(sent?.get('otpToken')).toBe('tok.sig');
    expect(sent?.get('claimedMemberId')).toBe('mem_reg');
    expect(sent?.get('fullName')).toBe('Sanjay Tomar');
  });

  it('skips the "is this you" question when the register has nobody on the number', async () => {
    const { user } = renderFlow(fakeOtp({ lookup: vi.fn<OtpApi['lookup']>().mockResolvedValue([]) }));
    await user.type(screen.getByLabelText('Mobile number'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '482913');
    await user.click(screen.getByRole('button', { name: 'Check code' }));

    expect(await screen.findByLabelText('Full name')).toBeTruthy();
  });

  it('says how many tries are left after a wrong code, and stays on the code', async () => {
    const otp = fakeOtp({
      verify: vi
        .fn<OtpApi['verify']>()
        .mockResolvedValue({ ok: false, code: 'OTP_INVALID', attemptsLeft: 4 }),
    });
    const { user } = renderFlow(otp);
    await user.type(screen.getByLabelText('Mobile number'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '111111');
    await user.click(screen.getByRole('button', { name: 'Check code' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'That code is not right. 4 tries left.',
    );
    expect(screen.getByLabelText('6-digit code')).toBeTruthy();
    expect(otp.lookup).not.toHaveBeenCalled();
  });

  it('tells the member to wait when the number has had too many codes', async () => {
    const { user } = renderFlow(
      fakeOtp({ send: vi.fn<OtpApi['send']>().mockResolvedValue({ ok: false, code: 'RATE_LIMITED' }) }),
    );
    await user.type(screen.getByLabelText('Mobile number'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Send code' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Too many codes for this number. Please try again in 15 minutes.',
    );
    expect(screen.getByLabelText('Mobile number')).toBeTruthy();
  });
});
