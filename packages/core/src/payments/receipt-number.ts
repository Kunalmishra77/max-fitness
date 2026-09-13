import { RECEIPT_PREFIX, RECEIPT_SEQUENCE_DIGITS, fyLabel, type ISTDate } from '@mfp/shared';
import { DomainError } from '../errors';

/**
 * Receipt numbers (BR-11.2): `MF/2026-27/000123`.
 *
 * Sequential per financial year, from a locked counter row — Indian accounting
 * expects a gapless series per FY, and an accountant asked to explain a missing
 * number will not accept "the database assigned it and the transaction rolled back".
 *
 * This module only formats and parses. Allocating the next value is a database
 * concern (`UPDATE Counter SET value = value + 1 RETURNING value` inside the payment
 * transaction, database-design.md §6), because gaplessness is a property of the
 * lock, not of the string.
 */

/** The `Counter.key` for a financial year, e.g. `receipt:2026-27`. */
export function receiptCounterKey(date: ISTDate): string {
  return `receipt:${fyLabel(date)}`;
}

/** `MF/2026-27/000123`. */
export function formatReceiptNumber(date: ISTDate, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new DomainError('VALIDATION_FAILED', 'Receipt sequence must be a positive whole number', {
      sequence,
    });
  }
  if (sequence >= 10 ** RECEIPT_SEQUENCE_DIGITS) {
    throw new DomainError(
      'VALIDATION_FAILED',
      `Receipt sequence exceeds ${RECEIPT_SEQUENCE_DIGITS} digits`,
      { sequence },
    );
  }
  return `${RECEIPT_PREFIX}/${fyLabel(date)}/${String(sequence).padStart(RECEIPT_SEQUENCE_DIGITS, '0')}`;
}

export interface ParsedReceiptNumber {
  readonly prefix: string;
  readonly financialYear: string;
  readonly sequence: number;
}

const RECEIPT_PATTERN = /^([A-Z]{2,6})\/(\d{4}-\d{2})\/(\d{6})$/;

export function parseReceiptNumber(value: string): ParsedReceiptNumber | null {
  const m = RECEIPT_PATTERN.exec(value);
  if (!m) return null;
  return { prefix: m[1] as string, financialYear: m[2] as string, sequence: Number(m[3]) };
}

/**
 * Case P8: on 1 April the counter for the new year starts at 1 again.
 *
 * A payment on 31 March and one on 1 April take numbers from different counters, so
 * the two series never interleave.
 */
export function isSameFinancialYear(a: ISTDate, b: ISTDate): boolean {
  return fyLabel(a) === fyLabel(b);
}

// ── Member codes (TRD §5) ────────────────────────────────────────────────────

/** `MF-0231`, assigned from a counter when a member's first payment confirms. */
export function formatMemberCode(sequence: number, digits = 4, prefix = 'MF-'): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new DomainError('VALIDATION_FAILED', 'Member code sequence must be a positive whole number', {
      sequence,
    });
  }
  // Past 9999 the code simply grows a digit rather than wrapping — a gym that gets
  // there has earned the extra character.
  return `${prefix}${String(sequence).padStart(digits, '0')}`;
}

export const MEMBER_CODE_COUNTER_KEY = 'member_code';
