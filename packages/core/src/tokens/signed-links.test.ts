import { describe, expect, it } from 'vitest';
import { FakeClock } from '@mfp/shared';
import { DomainError } from '../errors';
import { ist } from '../testing/builders';
import {
  buttonPayload,
  constantTimeEquals,
  issueToken,
  parseButtonPayload,
  verifyToken,
  verifyTokenOrThrow,
} from './signed-links';

const SECRET = 'a'.repeat(48);
const OTHER_SECRET = 'b'.repeat(48);

function clockAt(when: string): FakeClock {
  return new FakeClock(ist(when));
}

describe('issueToken', () => {
  it('produces a two-part base64url token', () => {
    const token = issueToken({
      purpose: 'renew',
      subject: 'mem_1',
      ttlSeconds: 3600,
      secret: SECRET,
      clock: clockAt('2026-09-10T10:00'),
    });
    expect(token.split('.')).toHaveLength(2);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('never contains the subject in clear text', () => {
    const token = issueToken({
      purpose: 'renew',
      subject: 'mem_secret_id',
      ttlSeconds: 3600,
      secret: SECRET,
      clock: clockAt('2026-09-10T10:00'),
    });
    expect(token).not.toContain('mem_secret_id');
  });

  it('produces a different token each time, thanks to the nonce', () => {
    const clock = clockAt('2026-09-10T10:00');
    const args = { purpose: 'renew', subject: 'mem_1', ttlSeconds: 3600, secret: SECRET, clock } as const;
    expect(issueToken(args)).not.toBe(issueToken(args));
  });

  it('refuses a weak secret', () => {
    expect(() =>
      issueToken({
        purpose: 'renew',
        subject: 'mem_1',
        ttlSeconds: 3600,
        secret: 'short',
        clock: clockAt('2026-09-10T10:00'),
      }),
    ).toThrow(DomainError);
  });

  it('refuses a non-positive or fractional TTL', () => {
    const clock = clockAt('2026-09-10T10:00');
    for (const ttlSeconds of [0, -1, 1.5]) {
      expect(() => issueToken({ purpose: 'renew', subject: 'm', ttlSeconds, secret: SECRET, clock })).toThrow(
        DomainError,
      );
    }
  });
});

describe('verifyToken — the happy path', () => {
  it('round-trips a valid token', () => {
    const clock = clockAt('2026-09-10T10:00');
    const token = issueToken({ purpose: 'renew', subject: 'mem_1', ttlSeconds: 3600, secret: SECRET, clock });

    const result = verifyToken({ token, purpose: 'renew', secret: SECRET, clock });
    expect(result).toMatchObject({ valid: true, subject: 'mem_1' });
  });

  it('works for every purpose', () => {
    const clock = clockAt('2026-09-10T10:00');
    for (const purpose of ['renew', 'receipt', 'unsub', 'restart', 'registration'] as const) {
      const token = issueToken({ purpose, subject: 'mem_1', ttlSeconds: 600, secret: SECRET, clock });
      expect(verifyToken({ token, purpose, secret: SECRET, clock }).valid, purpose).toBe(true);
    }
  });
});

describe('verifyToken — tampering', () => {
  const clock = clockAt('2026-09-10T10:00');
  const token = issueToken({ purpose: 'renew', subject: 'mem_1', ttlSeconds: 3600, secret: SECRET, clock });

  it('R23 — rejects a token signed with a different secret', () => {
    expect(verifyToken({ token, purpose: 'renew', secret: OTHER_SECRET, clock })).toEqual({
      valid: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('rejects an edited payload — swapping the subject to another member', () => {
    const [body] = token.split('.') as [string, string];
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
    payload['subject'] = 'mem_victim';
    const forgedBody = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const forged = `${forgedBody}.${token.split('.')[1]}`;

    expect(verifyToken({ token: forged, purpose: 'renew', secret: SECRET, clock })).toEqual({
      valid: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('rejects an extended expiry', () => {
    const [body, signature] = token.split('.') as [string, string];
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
    payload['expiresAt'] = 99_999_999_999;
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`;

    expect(verifyToken({ token: forged, purpose: 'renew', secret: SECRET, clock }).valid).toBe(false);
  });

  it('rejects a mangled signature', () => {
    const [body] = token.split('.') as [string, string];
    expect(verifyToken({ token: `${body}.deadbeef`, purpose: 'renew', secret: SECRET, clock })).toEqual({
      valid: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('rejects structurally malformed input without throwing', () => {
    for (const bad of ['', 'nodot', 'a.b.c', '!!!.???']) {
      const result = verifyToken({ token: bad, purpose: 'renew', secret: SECRET, clock });
      expect(result.valid, bad).toBe(false);
    }
  });

  it('rejects a payload that is valid base64 but not a token', () => {
    const body = Buffer.from(JSON.stringify({ hello: 'world' })).toString('base64url');
    expect(verifyToken({ token: `${body}.sig`, purpose: 'renew', secret: SECRET, clock })).toEqual({
      valid: false,
      reason: 'MALFORMED',
    });
  });
});

describe('verifyToken — purpose binding', () => {
  it('refuses to let a receipt link act as an unsubscribe', () => {
    const clock = clockAt('2026-09-10T10:00');
    const receipt = issueToken({
      purpose: 'receipt',
      subject: 'mem_1',
      ttlSeconds: 3600,
      secret: SECRET,
      clock,
    });
    expect(verifyToken({ token: receipt, purpose: 'unsub', secret: SECRET, clock })).toEqual({
      valid: false,
      reason: 'WRONG_PURPOSE',
    });
  });
});

describe('verifyToken — expiry', () => {
  it('accepts up to the last second and rejects at expiry', () => {
    const clock = clockAt('2026-09-10T10:00');
    const token = issueToken({ purpose: 'renew', subject: 'mem_1', ttlSeconds: 60, secret: SECRET, clock });

    clock.advanceMs(59_000);
    expect(verifyToken({ token, purpose: 'renew', secret: SECRET, clock }).valid).toBe(true);

    clock.advanceMs(1_000);
    expect(verifyToken({ token, purpose: 'renew', secret: SECRET, clock })).toEqual({
      valid: false,
      reason: 'EXPIRED',
    });
  });

  it('rejects a long-expired token', () => {
    const clock = clockAt('2026-09-10T10:00');
    const token = issueToken({ purpose: 'renew', subject: 'mem_1', ttlSeconds: 3600, secret: SECRET, clock });
    clock.advanceDays(30);
    expect(verifyToken({ token, purpose: 'renew', secret: SECRET, clock }).valid).toBe(false);
  });
});

describe('verifyTokenOrThrow', () => {
  const clock = clockAt('2026-09-10T10:00');

  it('returns the subject when valid', () => {
    const token = issueToken({ purpose: 'renew', subject: 'mem_1', ttlSeconds: 60, secret: SECRET, clock });
    expect(verifyTokenOrThrow({ token, purpose: 'renew', secret: SECRET, clock })).toBe('mem_1');
  });

  it('maps each failure to its own domain error code', () => {
    const token = issueToken({ purpose: 'renew', subject: 'mem_1', ttlSeconds: 60, secret: SECRET, clock });

    const expired = clockAt('2026-09-11T10:00');
    expect(() => verifyTokenOrThrow({ token, purpose: 'renew', secret: SECRET, clock: expired })).toThrow(
      expect.objectContaining({ code: 'TOKEN_EXPIRED' }),
    );
    expect(() => verifyTokenOrThrow({ token, purpose: 'unsub', secret: SECRET, clock })).toThrow(
      expect.objectContaining({ code: 'TOKEN_WRONG_PURPOSE' }),
    );
    expect(() =>
      verifyTokenOrThrow({ token: 'garbage', purpose: 'renew', secret: SECRET, clock }),
    ).toThrow(expect.objectContaining({ code: 'TOKEN_INVALID' }));
  });

  it('does not leak the token into the error message', () => {
    try {
      verifyTokenOrThrow({ token: 'sensitive-token-value', purpose: 'renew', secret: SECRET, clock });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain('sensitive-token-value');
    }
  });
});

describe('constantTimeEquals', () => {
  it('compares equal and unequal strings correctly', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
  });

  it('handles differing lengths without throwing', () => {
    expect(constantTimeEquals('short', 'a-much-longer-value')).toBe(false);
    expect(constantTimeEquals('', '')).toBe(true);
    expect(constantTimeEquals('', 'x')).toBe(false);
  });
});

describe('button payloads — BR-6.1', () => {
  it('builds and parses an unsubscribe payload', () => {
    const payload = buttonPayload('UNSUB', 'tok.en');
    expect(payload).toBe('UNSUB.tok.en');
    expect(parseButtonPayload(payload)).toEqual({ action: 'UNSUB', token: 'tok.en' });
  });

  it('builds and parses a restart payload', () => {
    expect(parseButtonPayload(buttonPayload('RESTART', 'abc'))).toEqual({ action: 'RESTART', token: 'abc' });
  });

  it('rejects an unknown action or a missing token', () => {
    expect(parseButtonPayload('DELETE.abc')).toBeNull();
    expect(parseButtonPayload('UNSUB.')).toBeNull();
    expect(parseButtonPayload('nodot')).toBeNull();
    expect(parseButtonPayload('')).toBeNull();
  });
});
