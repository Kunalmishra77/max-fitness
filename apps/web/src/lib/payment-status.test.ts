// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import type { PaymentSummary } from '@mfp/db';
import { fakeClockAt } from '@mfp/core/testing';
import { paymentStatusView } from './payment-status';

const deps = { secret: 'payment-status-test-secret-32-chars-min', clock: fakeClockAt('2026-09-11T10:00'), appUrl: 'https://gym.example' };

const paid: PaymentSummary = {
  paymentId: 'pay_1',
  memberId: 'mem_1',
  status: 'PAID',
  amountPaise: 400_000,
  receiptNo: 'MF/2026-27/000007',
  memberCode: 'MF-0012',
  membership: { startDate: istDate('2026-09-11'), endDate: istDate('2026-12-10'), durationMonths: 3 },
};

describe('paymentStatusView', () => {
  it('gives a paid payment its member code, receipt number, dates and a signed receipt link', () => {
    const view = paymentStatusView(paid, deps);

    expect(view).toMatchObject({
      status: 'PAID',
      amountPaise: 400_000,
      memberCode: 'MF-0012',
      receiptNo: 'MF/2026-27/000007',
      membership: { startDate: '2026-09-11', endDate: '2026-12-10' },
    });
    expect(view.status === 'PAID' && view.receiptUrl).toMatch(/^https:\/\/gym\.example\/r\/[\w-]+\.[\w-]+$/);
  });

  it.each(['PENDING', 'FAILED', 'NEEDS_REVIEW'] as const)('says only "%s" for a payment that is not paid', (status) => {
    expect(paymentStatusView({ ...paid, status, receiptNo: null, memberCode: null }, deps)).toEqual({ status });
  });
});
