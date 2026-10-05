import { describe, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import { DomainError } from '../errors';
import { fakeClockAt } from '../testing/builders';
import { firstChargeDate, isLiveMandate, mandateCycleCount, mandateStatusFrom } from './mandate';

describe('firstChargeDate', () => {
  const clock = fakeClockAt('2026-10-05T11:00');

  it('is the day after the cover the member already holds', () => {
    // They paid for a month on the 1st. Charging them today would take the same money twice.
    expect(firstChargeDate({ coveredUntil: istDate('2026-10-31'), clock })).toBe('2026-11-01');
  });

  it('is the day after a trial ends, which is the whole point of offering it to a trial member', () => {
    expect(firstChargeDate({ coveredUntil: istDate('2026-10-08'), clock })).toBe('2026-10-09');
  });

  it('is tomorrow for a member with no cover at all', () => {
    // Not today: a mandate authorised this afternoon cannot debit this afternoon, and the
    // desk takes the first fee at the counter anyway.
    expect(firstChargeDate({ coveredUntil: null, clock })).toBe('2026-10-06');
  });

  it('is tomorrow for a member whose cover already lapsed, not a date in the past', () => {
    expect(firstChargeDate({ coveredUntil: istDate('2026-08-31'), clock })).toBe('2026-10-06');
  });

  it('is tomorrow when the cover ends today, because a debit needs a future date', () => {
    expect(firstChargeDate({ coveredUntil: istDate('2026-10-05'), clock })).toBe('2026-10-06');
  });
});

describe('mandateCycleCount', () => {
  it('authorises about ten years of cover, whatever the term', () => {
    // Razorpay requires a finite count, so "indefinite" has to be spelled as a number. Ten
    // years is past the point where a gym membership is the same arrangement.
    expect(mandateCycleCount(3)).toBe(40);
    expect(mandateCycleCount(6)).toBe(20);
    expect(mandateCycleCount(12)).toBe(10);
  });

  it('stops at a hundred, which is as many cycles as Razorpay accepts', () => {
    expect(mandateCycleCount(1)).toBe(100);
  });

  it('refuses a term it was not given a whole number of months for', () => {
    expect(() => mandateCycleCount(0)).toThrow(DomainError);
    expect(() => mandateCycleCount(2.5)).toThrow(DomainError);
  });
});

describe('mandateStatusFrom', () => {
  it('mirrors every Razorpay subscription state one for one', () => {
    expect(mandateStatusFrom('created')).toBe('CREATED');
    expect(mandateStatusFrom('authenticated')).toBe('AUTHENTICATED');
    expect(mandateStatusFrom('active')).toBe('ACTIVE');
    expect(mandateStatusFrom('pending')).toBe('PENDING');
    expect(mandateStatusFrom('halted')).toBe('HALTED');
    expect(mandateStatusFrom('paused')).toBe('PAUSED');
    expect(mandateStatusFrom('cancelled')).toBe('CANCELLED');
    expect(mandateStatusFrom('completed')).toBe('COMPLETED');
    expect(mandateStatusFrom('expired')).toBe('EXPIRED');
  });
});

describe('isLiveMandate', () => {
  it('is true only while money can still arrive without anyone asking', () => {
    expect(isLiveMandate('ACTIVE')).toBe(true);
    expect(isLiveMandate('AUTHENTICATED')).toBe(true);
    expect(isLiveMandate('PENDING')).toBe(true);
  });

  it('is false before the member has authorised, so an unopened link never stops a reminder', () => {
    // A mandate the member was sent and never touched must not look like one they signed,
    // or the gym would stop chasing a fee that is never coming (ADR-105 §5).
    expect(isLiveMandate('CREATED')).toBe(false);
  });

  it('is false once it has halted, which is the case the gym must be told about', () => {
    expect(isLiveMandate('HALTED')).toBe(false);
    expect(isLiveMandate('PAUSED')).toBe(false);
    expect(isLiveMandate('CANCELLED')).toBe(false);
    expect(isLiveMandate('COMPLETED')).toBe(false);
    expect(isLiveMandate('EXPIRED')).toBe(false);
  });
});
