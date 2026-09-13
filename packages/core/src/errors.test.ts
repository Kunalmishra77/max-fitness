import { describe, expect, it } from 'vitest';
import { DOMAIN_ERROR_CODES, DomainError, domainError, isDomainError } from './errors';

describe('DomainError', () => {
  it('carries a stable code the API can map to a status', () => {
    const error = new DomainError('MEMBER_NOT_FOUND');
    expect(error.code).toBe('MEMBER_NOT_FOUND');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('DomainError');
  });

  it('falls back to the code as the message', () => {
    expect(new DomainError('FORBIDDEN').message).toBe('FORBIDDEN');
  });

  it('keeps meta for logs', () => {
    const error = domainError('PRICE_MISMATCH', 'The price has changed', { expectedPaise: 150_000 });
    expect(error.meta).toEqual({ expectedPaise: 150_000 });
    expect(error.toJSON()).toEqual({
      code: 'PRICE_MISMATCH',
      message: 'The price has changed',
      meta: { expectedPaise: 150_000 },
    });
  });

  it('is recognised by the type guard, and other errors are not', () => {
    expect(isDomainError(new DomainError('CONFLICT'))).toBe(true);
    expect(isDomainError(new Error('plain'))).toBe(false);
    expect(isDomainError('a string')).toBe(false);
    expect(isDomainError(null)).toBe(false);
  });

  it('has no duplicate codes', () => {
    expect(new Set(DOMAIN_ERROR_CODES).size).toBe(DOMAIN_ERROR_CODES.length);
  });
});
