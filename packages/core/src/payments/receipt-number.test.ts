import { describe, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import { DomainError } from '../errors';
import {
  MEMBER_CODE_COUNTER_KEY,
  formatMemberCode,
  formatReceiptNumber,
  isSameFinancialYear,
  parseReceiptNumber,
  receiptCounterKey,
} from './receipt-number';

const d = istDate;

describe('receiptCounterKey', () => {
  it('is per financial year, so each year gets its own counter row', () => {
    expect(receiptCounterKey(d('2026-09-10'))).toBe('receipt:2026-27');
    expect(receiptCounterKey(d('2027-03-31'))).toBe('receipt:2026-27');
    expect(receiptCounterKey(d('2027-04-01'))).toBe('receipt:2027-28');
  });
});

describe('formatReceiptNumber — BR-11.2', () => {
  it('produces MF/{FY}/{6 digits}', () => {
    expect(formatReceiptNumber(d('2026-09-10'), 1)).toBe('MF/2026-27/000001');
    expect(formatReceiptNumber(d('2026-09-10'), 123)).toBe('MF/2026-27/000123');
    expect(formatReceiptNumber(d('2026-09-10'), 999_999)).toBe('MF/2026-27/999999');
  });

  it('P8 — a payment on 1 April starts the new year at 1 again', () => {
    expect(formatReceiptNumber(d('2027-03-31'), 4_210)).toBe('MF/2026-27/004210');
    expect(formatReceiptNumber(d('2027-04-01'), 1)).toBe('MF/2027-28/000001');
  });

  it('rejects a sequence that is not a positive whole number', () => {
    for (const sequence of [0, -1, 1.5]) {
      expect(() => formatReceiptNumber(d('2026-09-10'), sequence), String(sequence)).toThrow(DomainError);
    }
  });

  it('rejects a sequence that would not fit in six digits', () => {
    expect(() => formatReceiptNumber(d('2026-09-10'), 1_000_000)).toThrow(/6 digits/);
  });
});

describe('parseReceiptNumber', () => {
  it('round-trips', () => {
    const value = formatReceiptNumber(d('2026-09-10'), 123);
    expect(parseReceiptNumber(value)).toEqual({ prefix: 'MF', financialYear: '2026-27', sequence: 123 });
  });

  it('returns null for anything that is not a receipt number', () => {
    for (const bad of ['', 'MF/2026-27/123', 'MF-2026-27-000123', 'mf/2026-27/000123', 'MF/202627/000123']) {
      expect(parseReceiptNumber(bad), bad).toBeNull();
    }
  });
});

describe('isSameFinancialYear', () => {
  it('spans the calendar year but breaks on 1 April', () => {
    expect(isSameFinancialYear(d('2026-04-01'), d('2027-03-31'))).toBe(true);
    expect(isSameFinancialYear(d('2027-03-31'), d('2027-04-01'))).toBe(false);
  });
});

describe('formatMemberCode — TRD §5', () => {
  it('produces MF-0231', () => {
    expect(formatMemberCode(231)).toBe('MF-0231');
    expect(formatMemberCode(1)).toBe('MF-0001');
  });

  it('grows past four digits rather than wrapping', () => {
    expect(formatMemberCode(12_345)).toBe('MF-12345');
  });

  it('rejects a bad sequence', () => {
    expect(() => formatMemberCode(0)).toThrow(DomainError);
    expect(() => formatMemberCode(-5)).toThrow(DomainError);
    expect(() => formatMemberCode(1.5)).toThrow(DomainError);
  });

  it('names the counter it draws from', () => {
    expect(MEMBER_CODE_COUNTER_KEY).toBe('member_code');
  });
});
