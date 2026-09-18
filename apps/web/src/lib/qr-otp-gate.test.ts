// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FakeClock, toE164 } from '@mfp/shared';
import { issueToken } from '@mfp/core';
import { qrOtpGate } from './qr-otp-gate';

/**
 * Whether a QR submission may go ahead, and whether it may claim a register entry (ADR-060).
 *
 * With OTP required, no proven number means no submission. Either way, only a proven
 * number may claim a register entry by id; without one the server matches by name.
 */

const secret = 's'.repeat(40);
const clock = new FakeClock(new Date('2026-09-18T04:30:00Z'));
const mobile = toE164('9876543210');
const tokenFor = (subject: string) => issueToken({ purpose: 'otp', subject, ttlSeconds: 900, secret, clock });
const deps = { clock, secret };

describe('qrOtpGate', () => {
  it('lets a submission through without a code when OTP is off, but ignores a claimed entry', () => {
    expect(qrOtpGate({ otpRequired: false, mobile, otpToken: null, claimedMemberId: 'mem_1' }, deps)).toEqual(
      { ok: true },
    );
  });

  it('honours a claimed entry when the number is proven', () => {
    const otpToken = tokenFor(`QR_EXISTING:${mobile}`);
    expect(qrOtpGate({ otpRequired: false, mobile, otpToken, claimedMemberId: 'mem_1' }, deps)).toEqual({
      ok: true,
      claimedMemberId: 'mem_1',
    });
    expect(qrOtpGate({ otpRequired: true, mobile, otpToken, claimedMemberId: null }, deps)).toEqual({
      ok: true,
    });
  });

  it('refuses when OTP is required and the token is missing, for another number, or for sign-up', () => {
    expect(qrOtpGate({ otpRequired: true, mobile, otpToken: null, claimedMemberId: null }, deps)).toEqual({
      ok: false,
    });
    expect(
      qrOtpGate(
        {
          otpRequired: true,
          mobile,
          otpToken: tokenFor(`QR_EXISTING:${toE164('9811111111')}`),
          claimedMemberId: null,
        },
        deps,
      ),
    ).toEqual({ ok: false });
    expect(
      qrOtpGate(
        { otpRequired: true, mobile, otpToken: tokenFor(`SIGNUP:${mobile}`), claimedMemberId: null },
        deps,
      ),
    ).toEqual({ ok: false });
  });
});
