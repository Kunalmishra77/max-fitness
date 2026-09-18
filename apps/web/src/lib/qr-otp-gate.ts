import { checkOtpToken } from '@mfp/core';
import type { Clock, E164Mobile } from '@mfp/shared';

/**
 * Whether a QR submission may go ahead, and whether it may claim a register entry (ADR-060).
 *
 * `otpRequired` is the gym's switch. A claimed entry is honoured only with a token that
 * proves this very number; without one the server falls back to matching by name, so a
 * guessed member id is worth nothing.
 */
export function qrOtpGate(
  input: {
    otpRequired: boolean;
    mobile: E164Mobile;
    otpToken: string | null;
    claimedMemberId: string | null;
  },
  deps: { clock: Clock; secret: string },
): { ok: false } | { ok: true; claimedMemberId?: string } {
  const proven =
    input.otpToken !== null &&
    checkOtpToken(input.otpToken, { mobile: input.mobile, purpose: 'QR_EXISTING' }, deps);
  if (input.otpRequired && !proven) return { ok: false };
  return proven && input.claimedMemberId !== null
    ? { ok: true, claimedMemberId: input.claimedMemberId }
    : { ok: true };
}
