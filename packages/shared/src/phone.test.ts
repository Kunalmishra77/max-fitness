import { describe, expect, it } from 'vitest';
import {
  InvalidMobileError,
  formatIndianMobile,
  isE164Mobile,
  isValidIndianMobile,
  nationalMobileDigits,
  nationalNumber,
  normaliseIndianMobile,
  toE164,
  whatsappLink,
} from './phone';

describe('normaliseIndianMobile', () => {
  it('accepts the many ways a person writes the same number', () => {
    const expected = '+919876543210';
    for (const input of [
      '9876543210',
      '09876543210',
      '+919876543210',
      '+91 9876543210',
      '+91 98765 43210',
      '+91-98765-43210',
      '0091 9876543210',
      '919876543210',
      '91 98765 43210',
      '  9876543210  ',
      '(98765) 43210',
      '98765.43210',
    ]) {
      expect(normaliseIndianMobile(input), input).toBe(expected);
    }
  });

  it('accepts every valid leading digit 6-9', () => {
    for (const first of ['6', '7', '8', '9']) {
      expect(normaliseIndianMobile(`${first}876543210`)).toBe(`+91${first}876543210`);
    }
  });

  it('rejects leading digits India does not issue to mobiles', () => {
    for (const first of ['0', '1', '2', '3', '4', '5']) {
      expect(normaliseIndianMobile(`${first}876543210`), first).toBeNull();
    }
  });

  it('rejects wrong lengths', () => {
    expect(normaliseIndianMobile('987654321')).toBeNull(); // 9 digits
    expect(normaliseIndianMobile('98765432101')).toBeNull(); // 11 digits
    expect(normaliseIndianMobile('')).toBeNull();
  });

  it('rejects other countries', () => {
    expect(normaliseIndianMobile('+14155552671')).toBeNull();
    expect(normaliseIndianMobile('+44 20 7946 0958')).toBeNull();
    expect(normaliseIndianMobile('0044 2079460958')).toBeNull();
  });

  it('rejects letters and junk', () => {
    expect(normaliseIndianMobile('98765abcde')).toBeNull();
    expect(normaliseIndianMobile('call me')).toBeNull();
    // Defends against unvalidated input arriving from a CSV cell.
    expect(nationalMobileDigits(42 as unknown as string)).toBeNull();
  });

  it('exposes the national digits separately', () => {
    expect(nationalMobileDigits('+91 98765 43210')).toBe('9876543210');
  });
});

describe('toE164', () => {
  it('returns a branded number', () => {
    expect(toE164('98765 43210')).toBe('+919876543210');
  });

  it('throws without echoing the value, so the message is safe to log', () => {
    try {
      toE164('12345');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidMobileError);
      expect((error as Error).message).not.toContain('12345');
    }
  });
});

describe('predicates and display', () => {
  it('validates', () => {
    expect(isValidIndianMobile('9876543210')).toBe(true);
    expect(isValidIndianMobile('1234567890')).toBe(false);
    expect(isE164Mobile('+919876543210')).toBe(true);
    expect(isE164Mobile('9876543210')).toBe(false);
    expect(isE164Mobile('+9198765432101')).toBe(false);
    expect(isE164Mobile(null)).toBe(false);
  });

  it('formats for the desk', () => {
    const m = toE164('9876543210');
    expect(nationalNumber(m)).toBe('9876543210');
    expect(formatIndianMobile(m)).toBe('98765 43210');
  });

  it('builds a wa.me link, with optional prefilled text', () => {
    const m = toE164('9876543210');
    expect(whatsappLink(m)).toBe('https://wa.me/919876543210');
    expect(whatsappLink(m, 'नमस्ते जी')).toBe('https://wa.me/919876543210?text=%E0%A4%A8%E0%A4%AE%E0%A4%B8%E0%A5%8D%E0%A4%A4%E0%A5%87%20%E0%A4%9C%E0%A5%80');
  });
});
