import { describe, expect, it } from 'vitest';
import {
  InvalidAmountError,
  assertPaise,
  formatINR,
  formatINRCompact,
  paiseToRupees,
  roundToNearestTenRupees,
  roundToRupee,
  rupeesToPaise,
} from './money';

describe('assertPaise — money is integer paise (CLAUDE.md §2.1)', () => {
  it('accepts integers, including zero and negatives (refunds)', () => {
    expect(assertPaise(0)).toBe(0);
    expect(assertPaise(150_000)).toBe(150_000);
    expect(assertPaise(-150_000)).toBe(-150_000);
  });

  it('rejects a float, which is how rounding errors get into the ledger', () => {
    expect(() => assertPaise(1500.5)).toThrow(InvalidAmountError);
    expect(() => assertPaise(0.1 + 0.2)).toThrow(InvalidAmountError);
    expect(() => assertPaise(NaN)).toThrow(InvalidAmountError);
    expect(() => assertPaise(Infinity)).toThrow(InvalidAmountError);
  });

  it('names the field in the error so the log says which amount was wrong', () => {
    expect(() => assertPaise(1.5, 'discountPaise')).toThrow(/discountPaise/);
  });

  it('rejects values beyond safe integer precision', () => {
    expect(() => assertPaise(Number.MAX_SAFE_INTEGER + 2)).toThrow(InvalidAmountError);
  });
});

describe('rupee conversions', () => {
  it('converts rupees to paise, rounding to the nearest paisa', () => {
    expect(rupeesToPaise(1500)).toBe(150_000);
    expect(rupeesToPaise(1333.33)).toBe(133_333);
    expect(rupeesToPaise(0)).toBe(0);
    // 19.99 * 100 is 1998.9999999999998 in binary floating point.
    expect(rupeesToPaise(19.99)).toBe(1999);
  });

  it('rejects a non-finite rupee amount', () => {
    expect(() => rupeesToPaise(NaN)).toThrow(InvalidAmountError);
  });

  it('converts paise back to rupees', () => {
    expect(paiseToRupees(150_000)).toBe(1500);
    expect(paiseToRupees(133_333)).toBe(1333.33);
  });
});

describe('formatINR — Indian digit grouping', () => {
  it('formats plan prices as whole rupees', () => {
    expect(formatINR(150_000)).toBe('₹1,500');
    expect(formatINR(120_000)).toBe('₹1,200');
    expect(formatINR(1_350_000)).toBe('₹13,500');
  });

  it('groups in lakhs and crores, not thousands', () => {
    // 1,23,456 — three digits, then pairs. Not 123,456.
    expect(formatINR(12_345_600)).toBe('₹1,23,456');
    expect(formatINR(1_234_567_800)).toBe('₹1,23,45,678');
  });

  it('shows paise only when there are any', () => {
    expect(formatINR(150_050)).toBe('₹1,500.50');
    expect(formatINR(150_000)).toBe('₹1,500');
    expect(formatINR(150_000, { showPaise: true })).toBe('₹1,500.00');
  });

  it('can omit the symbol for table columns that carry their own header', () => {
    expect(formatINR(150_000, { withSymbol: false })).toBe('1,500');
  });

  it('formats zero and negatives', () => {
    expect(formatINR(0)).toBe('₹0');
    expect(formatINR(-150_000)).toBe('-₹1,500');
  });

  it('refuses a float rather than silently rounding a price', () => {
    expect(() => formatINR(1500.5)).toThrow(InvalidAmountError);
  });
});

describe('formatINRCompact — CRM tiles', () => {
  it('uses lakhs above a lakh', () => {
    expect(formatINRCompact(14_000_000)).toBe('₹1.4L');
    expect(formatINRCompact(12_500_000)).toBe('₹1.25L');
    expect(formatINRCompact(10_000_000)).toBe('₹1L');
  });

  it('uses crores above a crore', () => {
    expect(formatINRCompact(1_000_000_000)).toBe('₹1Cr');
    expect(formatINRCompact(2_500_000_000)).toBe('₹2.5Cr');
  });

  it('falls back to the full figure below a lakh', () => {
    expect(formatINRCompact(150_000)).toBe('₹1,500');
    expect(formatINRCompact(9_999_900)).toBe('₹99,999');
  });

  it('labels in Hindi for the Hindi-first CRM', () => {
    expect(formatINRCompact(14_000_000, 'hi')).toBe('₹1.4 लाख');
    expect(formatINRCompact(1_000_000_000, 'hi')).toBe('₹1 करोड़');
  });
});

describe('rounding helpers', () => {
  it('rounds to the nearest rupee', () => {
    expect(roundToRupee(150_049)).toBe(150_000);
    expect(roundToRupee(150_050)).toBe(150_100);
  });

  it('rounds to the nearest ₹10 for the per-month display figure (BR-2.3, ADR-016)', () => {
    // ₹4,000 over 3 months is ₹1,333.33 -> shown as ₹1,330.
    expect(roundToNearestTenRupees(Math.round(400_000 / 3))).toBe(133_000);
    expect(formatINR(roundToNearestTenRupees(Math.round(400_000 / 3)))).toBe('₹1,330');
    // ₹7,500 over 6 months is exactly ₹1,250.
    expect(formatINR(roundToNearestTenRupees(750_000 / 6))).toBe('₹1,250');
    // ₹13,500 over 12 months is ₹1,125 -> nearest ₹10 is ₹1,130.
    expect(formatINR(roundToNearestTenRupees(1_350_000 / 12))).toBe('₹1,130');
  });
});
