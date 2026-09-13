import { describe, expect, it } from 'vitest';
import { LOG_REDACT_PATHS, maskEmail, maskMobile, maskName, maskStorageKey, maskToken } from './mask';

describe('maskMobile', () => {
  it('masks an E.164 number keeping enough to confirm it at the desk', () => {
    expect(maskMobile('+919876543210')).toBe('+91 98xxxxx210');
  });

  it('masks a bare national number', () => {
    expect(maskMobile('9876543210')).toBe('98xxxxx210');
  });

  it('handles formatted input', () => {
    expect(maskMobile('+91 98765 43210')).toBe('+91 98xxxxx210');
  });

  it('never returns the full number', () => {
    for (const input of ['+919876543210', '9876543210', '+91 98765 43210']) {
      expect(maskMobile(input)).not.toContain('98765432');
      expect(maskMobile(input)).not.toContain('6543');
    }
  });

  it('redacts rather than guessing when the value is absent or too short', () => {
    expect(maskMobile(null)).toBe('[redacted]');
    expect(maskMobile(undefined)).toBe('[redacted]');
    expect(maskMobile('')).toBe('[redacted]');
    expect(maskMobile('12345')).toBe('[redacted]');
  });
});

describe('maskEmail', () => {
  it('keeps two characters of the local part and the whole domain', () => {
    expect(maskEmail('arjun.sharma@example.com')).toBe('ar***@example.com');
  });

  it('keeps one character when the local part is very short', () => {
    expect(maskEmail('ab@example.com')).toBe('a***@example.com');
    expect(maskEmail('a@example.com')).toBe('a***@example.com');
  });

  it('redacts malformed addresses instead of leaking them', () => {
    expect(maskEmail('not-an-email')).toBe('[redacted]');
    expect(maskEmail('@example.com')).toBe('[redacted]');
    expect(maskEmail('user@')).toBe('[redacted]');
    expect(maskEmail(null)).toBe('[redacted]');
    expect(maskEmail('')).toBe('[redacted]');
  });

  it('never returns the local part in full', () => {
    expect(maskEmail('arjun.sharma@example.com')).not.toContain('sharma');
  });
});

describe('maskToken', () => {
  it('leaks nothing at all — correlate with a request id instead', () => {
    expect(maskToken('sk_live_verysecretvalue')).toBe('[redacted]');
    expect(maskToken('')).toBe('[redacted]');
    expect(maskToken(null)).toBe('[redacted]');
  });
});

describe('maskName', () => {
  it('shortens to first name plus last initial', () => {
    expect(maskName('Arjun Sharma')).toBe('Arjun S.');
    expect(maskName('  Priya   Singh Rathore ')).toBe('Priya R.');
  });

  it('leaves a single name alone — there is nothing to hide', () => {
    expect(maskName('Arjun')).toBe('Arjun');
  });

  it('redacts empty input', () => {
    expect(maskName('')).toBe('[redacted]');
    expect(maskName('   ')).toBe('[redacted]');
    expect(maskName(null)).toBe('[redacted]');
  });
});

describe('maskStorageKey', () => {
  it('keeps the prefix and hides the object name', () => {
    expect(maskStorageKey('selfies/2026/09/abc123def456.jpg')).toBe('selfies/2026/09/***');
  });

  it('redacts a key with no prefix, which would otherwise be the whole name', () => {
    expect(maskStorageKey('abc123.jpg')).toBe('[redacted]');
    expect(maskStorageKey(null)).toBe('[redacted]');
  });
});

describe('LOG_REDACT_PATHS', () => {
  it('covers every field the security plan names', () => {
    for (const field of ['mobile', 'email', 'pin', 'token', 'vector', 'authorization', 'cookie']) {
      expect(LOG_REDACT_PATHS.some((p) => p === field || p === `*.${field}`)).toBe(true);
    }
  });
});
