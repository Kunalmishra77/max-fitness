// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DomainError, issueToken, verifyToken } from '@mfp/core';
import { fakeClockAt } from '@mfp/core/testing';
import { RECEIPT_LINK_TTL_SECONDS, checkoutAccess, hashIp, receiptUrl } from './signup-access';

const secret = 'signup-access-test-secret-32-chars-min';
const clock = fakeClockAt('2026-09-11T10:00');
const token = (purpose: 'registration' | 'renew' | 'receipt', subject = 'mem_1') =>
  issueToken({ purpose, subject, ttlSeconds: 3600, secret, clock });

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof DomainError ? error.code : 'other';
  }
  return 'none';
};

describe('checkoutAccess', () => {
  it('grants a sign-up checkout to the member a registration token names', () => {
    const headers = new Headers({ 'x-registration-token': token('registration') });
    expect(checkoutAccess(headers, { secret, clock })).toEqual({ memberId: 'mem_1', mode: 'signup' });
  });

  it('grants a renewal checkout to the member a renew link names', () => {
    const headers = new Headers({ 'x-renew-token': token('renew', 'mem_2') });
    expect(checkoutAccess(headers, { secret, clock })).toEqual({ memberId: 'mem_2', mode: 'renewal' });
  });

  it('refuses a request with no token, a token for another purpose, or a tampered one', () => {
    expect(codeOf(() => checkoutAccess(new Headers(), { secret, clock }))).toBe('TOKEN_INVALID');
    expect(codeOf(() => checkoutAccess(new Headers({ 'x-registration-token': token('receipt') }), { secret, clock }))).toBe('TOKEN_WRONG_PURPOSE');
    expect(codeOf(() => checkoutAccess(new Headers({ 'x-renew-token': `${token('renew')}x` }), { secret, clock }))).toBe('TOKEN_INVALID');
  });

  it('refuses an expired token', () => {
    const headers = new Headers({ 'x-registration-token': token('registration') });
    expect(codeOf(() => checkoutAccess(headers, { secret, clock: fakeClockAt('2026-09-11T12:00') }))).toBe('TOKEN_EXPIRED');
  });
});

describe('hashIp', () => {
  it('is stable for one address, different for another, and never contains the address', () => {
    const a = hashIp('203.0.113.7', secret);
    expect(a).toBe(hashIp('203.0.113.7', secret));
    expect(a).not.toBe(hashIp('203.0.113.8', secret));
    expect(a).not.toContain('203.0.113.7');
  });

  it('depends on the secret, so the IPv4 space cannot be brute-forced from the hashes alone', () => {
    expect(hashIp('203.0.113.7', secret)).not.toBe(hashIp('203.0.113.7', `${secret}-other`));
  });

  it('records nothing when the address is unknown', () => {
    expect(hashIp('unknown', secret)).toBeNull();
  });
});

describe('receiptUrl', () => {
  it('links to the receipt page with a receipt-purpose token for the payment', () => {
    const url = new URL(receiptUrl('pay_1', { secret, clock, appUrl: 'https://maxfitness.example/' }));

    expect(url.origin).toBe('https://maxfitness.example');
    const [, prefix, value] = url.pathname.split('/');
    expect(prefix).toBe('r');
    const verified = verifyToken({ token: value ?? '', purpose: 'receipt', secret, clock });
    expect(verified).toMatchObject({ valid: true, subject: 'pay_1' });
    expect(verifyToken({ token: value ?? '', purpose: 'receipt', secret, clock: fakeClockAt('2026-12-11T10:00') })).toMatchObject({ valid: false });
    expect(RECEIPT_LINK_TTL_SECONDS).toBe(90 * 86_400);
  });
});
