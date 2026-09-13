/**
 * Money.
 *
 * CLAUDE.md §2.1: money is always an integer number of paise. Floats are banned —
 * `0.1 + 0.2` is not `0.3`, and a gym's yearly takings should not depend on that.
 * Rupees exist only at the UI edge, produced by `formatINR`.
 */

export class InvalidAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAmountError';
  }
}

/** Guard for values crossing a boundary (a form, a webhook, a CSV cell). */
export function assertPaise(value: number, label = 'amount'): number {
  if (!Number.isInteger(value)) {
    throw new InvalidAmountError(`${label} must be an integer number of paise, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new InvalidAmountError(`${label} is outside the safe integer range`);
  }
  return value;
}

/** ₹1,500 -> 150000 paise. Accepts a decimal rupee value and rounds to the nearest paisa. */
export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) {
    throw new InvalidAmountError(`Not a finite rupee amount: ${rupees}`);
  }
  return Math.round(rupees * 100);
}

/** 150000 paise -> 1500. For arithmetic keep paise; this is for display and charts. */
export function paiseToRupees(paise: number): number {
  return assertPaise(paise) / 100;
}

/**
 * Format paise as Indian currency with lakh/crore grouping: `150000` -> `"₹1,500"`,
 * `1234567800` -> `"₹1,23,45,678"`.
 *
 * Whole rupees by default — gym prices have no paise, and "₹1,500.00" reads like a
 * spreadsheet, not a price board. Pass `showPaise` when a value genuinely has them.
 */
export function formatINR(
  paise: number,
  options: { showPaise?: boolean; withSymbol?: boolean } = {},
): string {
  assertPaise(paise);
  const { showPaise = paise % 100 !== 0, withSymbol = true } = options;
  const fractionDigits = showPaise ? 2 : 0;

  const formatter = new Intl.NumberFormat('en-IN', {
    style: withSymbol ? 'currency' : 'decimal',
    currency: 'INR',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

  return formatter.format(paise / 100);
}

/**
 * Compact form for CRM tiles where space is tight: `"₹1.25 लाख"` / `"₹1.25L"`.
 * Full precision belongs on the detail screen, not the tile.
 */
export function formatINRCompact(paise: number, locale: 'en' | 'hi' = 'en'): string {
  assertPaise(paise);
  const rupees = paise / 100;
  const lakhLabel = locale === 'hi' ? ' लाख' : 'L';
  const croreLabel = locale === 'hi' ? ' करोड़' : 'Cr';

  if (Math.abs(rupees) >= 10_000_000) {
    return `₹${trimZeros(rupees / 10_000_000)}${croreLabel}`;
  }
  if (Math.abs(rupees) >= 100_000) {
    return `₹${trimZeros(rupees / 100_000)}${lakhLabel}`;
  }
  return formatINR(paise, { showPaise: false });
}

function trimZeros(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, '');
}

/** Round paise to the nearest whole rupee. */
export function roundToRupee(paise: number): number {
  return Math.round(assertPaise(paise) / 100) * 100;
}

/**
 * Round paise to the nearest ₹10, used by the "effective per month" figure on plan
 * cards (BR-2.3, ADR-016). Display only — nobody is ever charged this number.
 */
export function roundToNearestTenRupees(paise: number): number {
  return Math.round(paise / 1000) * 1000;
}
