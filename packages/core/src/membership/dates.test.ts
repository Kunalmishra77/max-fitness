import { describe, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import { DomainError } from '../errors';
import {
  ageOn,
  assertNoOverlap,
  assertValidStartDate,
  coversDate,
  declaredMembershipPeriod,
  isMinorOn,
  membershipEndDate,
  membershipPeriod,
  periodsOverlap,
  renewalChainsOn,
  renewalStartDate,
} from './dates';

const d = istDate;

describe('membershipEndDate — BR-3.1', () => {
  it('matches the three worked examples in the rule', () => {
    // 10 Sep 2026 + 1M -> 9 Oct 2026
    expect(membershipEndDate(d('2026-09-10'), 1)).toBe('2026-10-09');
    // 31 Jan 2027 + 1M -> 28 Feb 2027 - 1 day = 27 Feb 2027
    expect(membershipEndDate(d('2027-01-31'), 1)).toBe('2027-02-27');
    // 29 Feb 2028 + 12M -> 28 Feb 2029 - 1 = 27 Feb 2029
    expect(membershipEndDate(d('2028-02-29'), 12)).toBe('2029-02-27');
  });

  it('handles the four plan durations', () => {
    expect(membershipEndDate(d('2026-09-10'), 1)).toBe('2026-10-09');
    expect(membershipEndDate(d('2026-09-10'), 3)).toBe('2026-12-09');
    expect(membershipEndDate(d('2026-09-10'), 6)).toBe('2027-03-09');
    expect(membershipEndDate(d('2026-09-10'), 12)).toBe('2027-09-09');
  });

  it('gives a full month starting on the 1st', () => {
    expect(membershipEndDate(d('2026-09-01'), 1)).toBe('2026-09-30');
    expect(membershipEndDate(d('2026-02-01'), 1)).toBe('2026-02-28');
    expect(membershipEndDate(d('2028-02-01'), 1)).toBe('2028-02-29');
  });

  it('clamps a 31st start into a 30-day month', () => {
    expect(membershipEndDate(d('2026-03-31'), 1)).toBe('2026-04-29');
    expect(membershipEndDate(d('2026-08-31'), 1)).toBe('2026-09-29');
  });

  it('crosses the year boundary', () => {
    expect(membershipEndDate(d('2026-12-15'), 1)).toBe('2027-01-14');
    expect(membershipEndDate(d('2026-12-31'), 12)).toBe('2027-12-30');
  });

  it('rejects a duration that is not a whole month count', () => {
    expect(() => membershipEndDate(d('2026-09-10'), 0)).toThrow(DomainError);
    expect(() => membershipEndDate(d('2026-09-10'), -1)).toThrow(DomainError);
    expect(() => membershipEndDate(d('2026-09-10'), 1.5)).toThrow(DomainError);
  });

  it('returns the whole period', () => {
    expect(membershipPeriod(d('2026-09-10'), 3)).toEqual({
      startDate: '2026-09-10',
      endDate: '2026-12-09',
    });
  });
});

describe('declaredMembershipPeriod — BR-3.6', () => {
  it('works the start date backwards when the plan length is known', () => {
    // Inverse of BR-3.1: end 2026-10-09, 1 month -> start 2026-09-10.
    expect(declaredMembershipPeriod(d('2026-10-09'), 1)).toEqual({
      startDate: '2026-09-10',
      endDate: '2026-10-09',
    });
    expect(declaredMembershipPeriod(d('2026-12-09'), 3)).toEqual({
      startDate: '2026-09-10',
      endDate: '2026-12-09',
    });
  });

  it('round-trips with membershipEndDate', () => {
    for (const months of [1, 3, 6, 12] as const) {
      const start = d('2026-09-10');
      const end = membershipEndDate(start, months);
      expect(declaredMembershipPeriod(end, months).startDate).toBe(start);
    }
  });

  it('leaves the start date null when the plan is unknown — we do not invent one', () => {
    expect(declaredMembershipPeriod(d('2026-10-09'), null)).toEqual({
      startDate: null,
      endDate: '2026-10-09',
    });
  });
});

describe('renewalStartDate — BR-3.4', () => {
  const graceDays = 5;

  it('chains on from the old end date while the membership is still active — case P6', () => {
    expect(
      renewalStartDate({
        currentEndDate: d('2026-09-20'),
        paymentDate: d('2026-09-10'),
        renewalGraceDays: graceDays,
      }),
    ).toBe('2026-09-21');
  });

  it('chains on when renewing on the last day', () => {
    expect(
      renewalStartDate({
        currentEndDate: d('2026-09-10'),
        paymentDate: d('2026-09-10'),
        renewalGraceDays: graceDays,
      }),
    ).toBe('2026-09-11');
  });

  it('chains on anywhere inside the grace window', () => {
    for (let daysLate = 1; daysLate <= graceDays; daysLate += 1) {
      const payment = d(`2026-09-${String(10 + daysLate).padStart(2, '0')}`);
      expect(
        renewalStartDate({ currentEndDate: d('2026-09-10'), paymentDate: payment, renewalGraceDays: graceDays }),
        `${daysLate} days late`,
      ).toBe('2026-09-11');
    }
  });

  it('restarts from the payment date once the grace window has passed — case P7', () => {
    expect(
      renewalStartDate({
        currentEndDate: d('2026-09-10'),
        paymentDate: d('2026-09-16'), // 6 days late, grace is 5
        renewalGraceDays: graceDays,
      }),
    ).toBe('2026-09-16');
  });

  it('starts from the payment date for a member with no history', () => {
    expect(
      renewalStartDate({ currentEndDate: null, paymentDate: d('2026-09-10'), renewalGraceDays: graceDays }),
    ).toBe('2026-09-10');
  });

  it('honours a zero grace period', () => {
    expect(
      renewalStartDate({ currentEndDate: d('2026-09-10'), paymentDate: d('2026-09-11'), renewalGraceDays: 0 }),
    ).toBe('2026-09-11');
    expect(
      renewalStartDate({ currentEndDate: d('2026-09-10'), paymentDate: d('2026-09-10'), renewalGraceDays: 0 }),
    ).toBe('2026-09-11');
  });

  it('rejects a nonsensical grace setting', () => {
    expect(() =>
      renewalStartDate({ currentEndDate: d('2026-09-10'), paymentDate: d('2026-09-10'), renewalGraceDays: -1 }),
    ).toThrow(DomainError);
  });

  it('reports whether the renewal chained on, for the desk message', () => {
    const within = { currentEndDate: d('2026-09-10'), paymentDate: d('2026-09-13'), renewalGraceDays: graceDays };
    const after = { currentEndDate: d('2026-09-10'), paymentDate: d('2026-09-20'), renewalGraceDays: graceDays };
    expect(renewalChainsOn(within)).toBe(true);
    expect(renewalChainsOn(after)).toBe(false);
    expect(renewalChainsOn({ currentEndDate: null, paymentDate: d('2026-09-10'), renewalGraceDays: graceDays })).toBe(
      false,
    );
  });
});

describe('overlap — BR-3.5', () => {
  const sept = { startDate: d('2026-09-01'), endDate: d('2026-09-30') };

  it('detects an overlap at either edge', () => {
    expect(periodsOverlap(sept, { startDate: d('2026-09-30'), endDate: d('2026-10-30') })).toBe(true);
    expect(periodsOverlap(sept, { startDate: d('2026-08-01'), endDate: d('2026-09-01') })).toBe(true);
  });

  it('allows a contiguous renewal — the day after is not an overlap', () => {
    expect(periodsOverlap(sept, { startDate: d('2026-10-01'), endDate: d('2026-10-31') })).toBe(false);
    expect(periodsOverlap(sept, { startDate: d('2026-08-01'), endDate: d('2026-08-31') })).toBe(false);
  });

  it('detects full containment either way round', () => {
    expect(periodsOverlap(sept, { startDate: d('2026-09-10'), endDate: d('2026-09-20') })).toBe(true);
    expect(periodsOverlap({ startDate: d('2026-09-10'), endDate: d('2026-09-20') }, sept)).toBe(true);
  });

  it('treats a start-less declared membership as covering only its end date', () => {
    const declared = { startDate: null, endDate: d('2026-09-15') };
    expect(periodsOverlap(sept, declared)).toBe(true);
    expect(periodsOverlap({ startDate: d('2026-10-01'), endDate: d('2026-10-31') }, declared)).toBe(false);
  });

  it('throws with the clashing dates when asserting', () => {
    expect(() => assertNoOverlap({ startDate: d('2026-09-15'), endDate: d('2026-10-14') }, [sept])).toThrow(
      DomainError,
    );
    expect(() => assertNoOverlap({ startDate: d('2026-10-01'), endDate: d('2026-10-31') }, [sept])).not.toThrow();
    expect(() => assertNoOverlap({ startDate: d('2026-10-01'), endDate: d('2026-10-31') }, [])).not.toThrow();
  });
});

describe('assertValidStartDate — BR-3.3', () => {
  const today = d('2026-09-10');

  it('accepts today', () => {
    expect(() => assertValidStartDate(today, today, 15)).not.toThrow();
  });

  it('accepts a date inside the look-ahead window', () => {
    expect(() => assertValidStartDate(d('2026-09-25'), today, 15)).not.toThrow();
  });

  it('rejects a date beyond the window', () => {
    expect(() => assertValidStartDate(d('2026-09-26'), today, 15)).toThrow(DomainError);
  });

  it('rejects a start date in the past — backdating is a desk action', () => {
    expect(() => assertValidStartDate(d('2026-09-09'), today, 15)).toThrow(/past/);
  });
});

describe('coversDate — BR-3.2, valid through endDate inclusive', () => {
  const period = { startDate: d('2026-09-01'), endDate: d('2026-09-30') };

  it('covers the first and last day', () => {
    expect(coversDate(period, d('2026-09-01'))).toBe(true);
    expect(coversDate(period, d('2026-09-30'))).toBe(true);
  });

  it('does not cover the day after', () => {
    expect(coversDate(period, d('2026-10-01'))).toBe(false);
    expect(coversDate(period, d('2026-08-31'))).toBe(false);
  });

  it('treats a start-less period as its end date only', () => {
    expect(coversDate({ startDate: null, endDate: d('2026-09-30') }, d('2026-09-30'))).toBe(true);
    expect(coversDate({ startDate: null, endDate: d('2026-09-30') }, d('2026-09-29'))).toBe(false);
  });
});

describe('age — BR-12.1 and BR-12.2', () => {
  it('counts full years on today', () => {
    expect(ageOn(d('2000-09-10'), d('2026-09-10'))).toBe(26);
    expect(ageOn(d('2000-09-11'), d('2026-09-10'))).toBe(25);
    expect(ageOn(d('2000-09-10'), d('2026-09-09'))).toBe(25);
    expect(ageOn(d('2000-12-31'), d('2026-01-01'))).toBe(25);
  });

  it('handles a leap-day birthday', () => {
    expect(ageOn(d('2008-02-29'), d('2027-02-28'))).toBe(18);
    expect(ageOn(d('2008-02-29'), d('2028-02-29'))).toBe(20);
  });

  it('flags a minor', () => {
    expect(isMinorOn(d('2009-09-11'), d('2026-09-10'))).toBe(true); // 16
    expect(isMinorOn(d('2008-09-10'), d('2026-09-10'))).toBe(false); // exactly 18
    expect(isMinorOn(d('2008-09-11'), d('2026-09-10'))).toBe(true); // 17
  });
});
