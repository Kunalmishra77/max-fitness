import { describe, expect, it } from 'vitest';
import { publicPaymentStatus } from './signup-read.repository';

describe('publicPaymentStatus', () => {
  it.each([
    ['PAID', null, 'PAID'],
    ['CREATED', null, 'PENDING'],
    // Money arrived but did not match the order: the gym checks it, the member is not told "failed".
    ['CREATED', 'AMOUNT_MISMATCH', 'NEEDS_REVIEW'],
    ['FAILED', 'Payment was declined by the bank', 'FAILED'],
    ['VOIDED', null, 'FAILED'],
    ['REFUNDED', null, 'FAILED'],
  ] as const)('%s with reason %s is shown as %s', (status, reason, expected) => {
    expect(publicPaymentStatus(status, reason)).toBe(expected);
  });
});
