import { beforeEach, describe, expect, it } from 'vitest';
import { toE164, type E164Mobile } from '@mfp/shared';
import { fakeClockAt } from '../testing/builders';
import { checkOtpToken, sendOtp, verifyOtp, type OtpRecord, type OtpSender, type OtpStore } from './otp.service';

/**
 * One-time codes for the reception QR (api-specification §/otp; qr-onboarding-flow §3).
 *
 * A code proves the person holding the phone owns the number, so the lookup may show
 * them the register's entry for it. The code is stored only as a keyed hash, lives ten
 * minutes, allows five guesses, and a number can be sent three codes in fifteen minutes.
 * A right code is exchanged for a short-lived token bound to that number and purpose.
 */

const SECRET = 'x'.repeat(40);
const MOBILE = toE164('9876543210');

class MemoryOtpStore implements OtpStore {
  rows: (OtpRecord & { mobile: E164Mobile; purpose: string; createdAt: Date })[] = [];
  countSince(_gymId: string, mobile: E164Mobile, purpose: string, since: Date) {
    return Promise.resolve(this.rows.filter((r) => r.mobile === mobile && r.purpose === purpose && r.createdAt > since).length);
  }
  create(row: { gymId: string; mobile: E164Mobile; purpose: string; codeHash: string; expiresAt: Date; createdAt: Date }) {
    this.rows.push({ id: `otp_${this.rows.length + 1}`, attempts: 0, consumedAt: null, ...row });
    return Promise.resolve();
  }
  latestOpen(_gymId: string, mobile: E164Mobile, purpose: string, now: Date) {
    const open = this.rows.filter((r) => r.mobile === mobile && r.purpose === purpose && r.consumedAt === null && r.expiresAt > now);
    return Promise.resolve(open.at(-1) ?? null);
  }
  recordFailedAttempt(id: string) {
    const row = this.rows.find((r) => r.id === id);
    if (row !== undefined) row.attempts += 1;
    return Promise.resolve();
  }
  consume(id: string, at: Date) {
    const row = this.rows.find((r) => r.id === id);
    if (row === undefined || row.consumedAt !== null) return Promise.resolve(false);
    row.consumedAt = at;
    return Promise.resolve(true);
  }
}

class RecordingSender implements OtpSender {
  sent: { to: E164Mobile; code: string; language: string }[] = [];
  send(to: E164Mobile, code: string, language: 'hi' | 'en') {
    this.sent.push({ to, code, language });
    return Promise.resolve();
  }
}

let store: MemoryOtpStore;
let sender: RecordingSender;
let clock: ReturnType<typeof fakeClockAt>;
let codes: string[];

const deps = () => ({ clock, store, sender, gymId: 'gym_1', secret: SECRET, randomCode: () => codes.shift() ?? '000000' });

beforeEach(() => {
  store = new MemoryOtpStore();
  sender = new RecordingSender();
  clock = fakeClockAt('2026-09-18T10:00');
  codes = ['482913', '105577', '220044', '999999'];
});

describe('sendOtp', () => {
  it('sends a six-digit code and keeps only a hash of it', async () => {
    const result = await sendOtp({ mobile: MOBILE, purpose: 'QR_EXISTING', language: 'hi' }, deps());

    expect(result).toEqual({ expiresInSec: 600, code: '482913' });
    expect(sender.sent).toEqual([{ to: MOBILE, code: '482913', language: 'hi' }]);
    expect(store.rows[0]?.codeHash).not.toContain('482913');
    expect(store.rows[0]?.expiresAt).toEqual(new Date(clock.now().getTime() + 600_000));
  });

  it('allows three codes a number in fifteen minutes, then says when to try again', async () => {
    for (let i = 0; i < 3; i += 1) await sendOtp({ mobile: MOBILE, purpose: 'QR_EXISTING', language: 'en' }, deps());

    await expect(sendOtp({ mobile: MOBILE, purpose: 'QR_EXISTING', language: 'en' }, deps())).rejects.toMatchObject({ code: 'OTP_RATE_LIMITED' });
    expect(sender.sent).toHaveLength(3);

    clock.advanceMinutes(15);
    await expect(sendOtp({ mobile: MOBILE, purpose: 'QR_EXISTING', language: 'en' }, deps())).resolves.toMatchObject({ expiresInSec: 600 });
  });
});

describe('verifyOtp', () => {
  it('exchanges the right code for a token bound to the number and purpose, once', async () => {
    await sendOtp({ mobile: MOBILE, purpose: 'QR_EXISTING', language: 'en' }, deps());

    const { otpToken } = await verifyOtp({ mobile: MOBILE, purpose: 'QR_EXISTING', code: '482913' }, deps());

    expect(checkOtpToken(otpToken, { mobile: MOBILE, purpose: 'QR_EXISTING' }, { clock, secret: SECRET })).toBe(true);
    expect(checkOtpToken(otpToken, { mobile: toE164('9811111111'), purpose: 'QR_EXISTING' }, { clock, secret: SECRET })).toBe(false);
    expect(checkOtpToken(otpToken, { mobile: MOBILE, purpose: 'SIGNUP' }, { clock, secret: SECRET })).toBe(false);
    // Used up: the same code cannot be exchanged again.
    await expect(verifyOtp({ mobile: MOBILE, purpose: 'QR_EXISTING', code: '482913' }, deps())).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('lets the token live fifteen minutes', async () => {
    await sendOtp({ mobile: MOBILE, purpose: 'QR_EXISTING', language: 'en' }, deps());
    const { otpToken } = await verifyOtp({ mobile: MOBILE, purpose: 'QR_EXISTING', code: '482913' }, deps());

    clock.advanceMinutes(14);
    expect(checkOtpToken(otpToken, { mobile: MOBILE, purpose: 'QR_EXISTING' }, { clock, secret: SECRET })).toBe(true);
    clock.advanceMinutes(2);
    expect(checkOtpToken(otpToken, { mobile: MOBILE, purpose: 'QR_EXISTING' }, { clock, secret: SECRET })).toBe(false);
  });

  it('counts wrong guesses and locks the code after five', async () => {
    await sendOtp({ mobile: MOBILE, purpose: 'QR_EXISTING', language: 'en' }, deps());

    await expect(verifyOtp({ mobile: MOBILE, purpose: 'QR_EXISTING', code: '111111' }, deps())).rejects.toMatchObject({
      code: 'OTP_INVALID',
      meta: { attemptsLeft: 4 },
    });
    for (let i = 0; i < 4; i += 1) {
      await expect(verifyOtp({ mobile: MOBILE, purpose: 'QR_EXISTING', code: '111111' }, deps())).rejects.toMatchObject({ code: 'OTP_INVALID' });
    }
    // Even the right code is refused now: a new one has to be sent.
    await expect(verifyOtp({ mobile: MOBILE, purpose: 'QR_EXISTING', code: '482913' }, deps())).rejects.toMatchObject({ code: 'OTP_LOCKED' });
  });

  it('refuses a code after ten minutes, and only the latest code counts', async () => {
    await sendOtp({ mobile: MOBILE, purpose: 'QR_EXISTING', language: 'en' }, deps());
    clock.advanceMinutes(11);
    await expect(verifyOtp({ mobile: MOBILE, purpose: 'QR_EXISTING', code: '482913' }, deps())).rejects.toMatchObject({ code: 'OTP_EXPIRED' });

    await sendOtp({ mobile: MOBILE, purpose: 'QR_EXISTING', language: 'en' }, deps());
    await sendOtp({ mobile: MOBILE, purpose: 'QR_EXISTING', language: 'en' }, deps());
    await expect(verifyOtp({ mobile: MOBILE, purpose: 'QR_EXISTING', code: '105577' }, deps())).rejects.toMatchObject({ code: 'OTP_INVALID' });
    await expect(verifyOtp({ mobile: MOBILE, purpose: 'QR_EXISTING', code: '220044' }, deps())).resolves.toHaveProperty('otpToken');
  });

  it('rejects anything that is not six digits without spending a guess', async () => {
    await sendOtp({ mobile: MOBILE, purpose: 'QR_EXISTING', language: 'en' }, deps());
    await expect(verifyOtp({ mobile: MOBILE, purpose: 'QR_EXISTING', code: '12ab' }, deps())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(store.rows[0]?.attempts).toBe(0);
  });
});

describe('checkOtpToken', () => {
  it('refuses a forged or garbled token', () => {
    expect(checkOtpToken('not-a-token', { mobile: MOBILE, purpose: 'QR_EXISTING' }, { clock, secret: SECRET })).toBe(false);
  });
});
