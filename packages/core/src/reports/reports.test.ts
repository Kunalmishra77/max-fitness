import { describe, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import { busyHours, kioskShare, largestRemainderShares, membershipFlow, monthBounds, moneyByMethod, type MembershipForReport } from './reports';

/**
 * The owner's reports (crm-module-spec §6; crm-ux-blueprint §13).
 *
 * The database adds things up; these decide what the sums mean — which month "this
 * month" is in IST, what counts as a renewal rather than a comeback, why a renewal rate
 * only counts memberships whose grace has already run out, and how percentages are
 * rounded so a plan mix always adds up to 100.
 */

describe('monthBounds', () => {
  it('gives this month and last month as IST calendar dates', () => {
    expect(monthBounds(istDate('2026-09-14'))).toEqual({
      start: '2026-09-01',
      end: '2026-09-30',
      previousStart: '2026-08-01',
      previousEnd: '2026-08-31',
      previousToDate: '2026-08-14',
    });
  });

  it('compares a month so far with last month up to the same day, never with all of it', () => {
    // On the 14th, fourteen days of September against all of August would say "less"
    // almost every month. Like with like: August 1st to 14th.
    expect(monthBounds(istDate('2026-09-14')).previousToDate).toBe('2026-08-14');
    // A day last month did not have stops at its last day.
    expect(monthBounds(istDate('2026-03-31')).previousToDate).toBe('2026-02-28');
  });

  it('crosses the year in January, and knows February is short', () => {
    expect(monthBounds(istDate('2026-01-10'))).toMatchObject({ previousStart: '2025-12-01', previousEnd: '2025-12-31' });
    expect(monthBounds(istDate('2028-02-03'))).toMatchObject({ end: '2028-02-29' });
  });
});

describe('largestRemainderShares', () => {
  it('rounds to whole percentages that always add up to 100', () => {
    expect(largestRemainderShares([1, 1, 1])).toEqual([34, 33, 33]);
    expect(largestRemainderShares([5, 3, 1, 1])).toEqual([50, 30, 10, 10]);
    expect(largestRemainderShares([2, 1]).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('is all zeros when there is nothing to share', () => {
    expect(largestRemainderShares([0, 0])).toEqual([0, 0]);
  });
});

describe('moneyByMethod', () => {
  it('totals real money by method, biggest first, against last month', () => {
    const result = moneyByMethod({
      thisMonth: [
        { method: 'CASH', amountPaise: 300_000 },
        { method: 'UPI_DIRECT', amountPaise: 600_000 },
        { method: 'CASH', amountPaise: 100_000 },
      ],
      lastMonth: [{ method: 'CASH', amountPaise: 800_000 }],
    });

    expect(result).toEqual({
      totalPaise: 1_000_000,
      lastMonthPaise: 800_000,
      deltaPaise: 200_000,
      byMethod: [
        { method: 'UPI_DIRECT', amountPaise: 600_000, share: 60 },
        { method: 'CASH', amountPaise: 400_000, share: 40 },
      ],
      demoPaise: 0,
    });
  });

  it('keeps demo payments out of the total, so they are never read as income (ADR-037)', () => {
    const result = moneyByMethod({
      thisMonth: [
        { method: 'CASH', amountPaise: 150_000 },
        { method: 'SIMULATED', amountPaise: 400_000 },
      ],
      lastMonth: [{ method: 'SIMULATED', amountPaise: 999_000 }],
    });

    expect(result).toMatchObject({ totalPaise: 150_000, lastMonthPaise: 0, demoPaise: 400_000 });
    expect(result.byMethod.map((row) => row.method)).toEqual(['CASH']);
  });
});

describe('busyHours', () => {
  // 2026-09-07 is a Monday; 2026-09-12 is a Saturday. Times below are IST.
  const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);

  it('averages visits per weekday and per weekend day, by IST hour', () => {
    const rows = busyHours({
      capturedAt: [at('2026-09-07', '06:10'), at('2026-09-07', '06:50'), at('2026-09-08', '06:30'), at('2026-09-12', '18:05')],
      from: istDate('2026-09-07'),
      to: istDate('2026-09-13'),
    });

    // Five weekdays and two weekend days in the window.
    expect(rows).toEqual([
      { hour: 6, weekday: 0.6, weekend: 0 },
      { hour: 18, weekday: 0, weekend: 0.5 },
    ]);
  });

  it('puts a visit just after midnight UTC on the right IST hour and day', () => {
    // 23:30 IST on Friday the 11th is 18:00Z the same day; 00:30 IST on Saturday is 19:00Z Friday.
    const rows = busyHours({ capturedAt: [at('2026-09-12', '00:30')], from: istDate('2026-09-07'), to: istDate('2026-09-13') });
    expect(rows).toEqual([{ hour: 0, weekday: 0, weekend: 0.5 }]);
  });

  it('is empty when nobody came', () => {
    expect(busyHours({ capturedAt: [], from: istDate('2026-09-07'), to: istDate('2026-09-13') })).toEqual([]);
  });
});

describe('kioskShare', () => {
  it('is the share of check-ins the kiosk recognised on its own, or null when there were none', () => {
    expect(kioskShare(['FACE', 'FACE_CONFIRMED', 'MANUAL', 'MANUAL'])).toBe(50);
    expect(kioskShare([])).toBeNull();
  });
});

describe('membershipFlow', () => {
  const ms = (memberId: string, startDate: string, endDate: string, confirmedOn: string): MembershipForReport => ({
    memberId,
    startDate: istDate(startDate),
    endDate: istDate(endDate),
    confirmedAt: new Date(`${confirmedOn}T11:00:00+05:30`),
  });

  const september = { monthStart: istDate('2026-09-01'), monthEnd: istDate('2026-09-30'), today: istDate('2026-09-20'), graceDays: 5 };

  it('counts a member whose first membership was confirmed this month as new', () => {
    const flow = membershipFlow([ms('a', '2026-09-03', '2026-10-02', '2026-09-03')], september);
    expect(flow).toMatchObject({ newMembers: 1, renewals: 0 });
  });

  it('counts a membership that starts within grace of the previous one as a renewal, not a new member', () => {
    const flow = membershipFlow([ms('a', '2026-08-01', '2026-08-31', '2026-08-01'), ms('a', '2026-09-04', '2026-10-03', '2026-09-04')], september);
    expect(flow).toMatchObject({ newMembers: 0, renewals: 1 });
  });

  it('counts someone back after the grace period as neither: they came back, they did not renew', () => {
    const flow = membershipFlow([ms('a', '2026-07-01', '2026-07-31', '2026-07-01'), ms('a', '2026-09-10', '2026-10-09', '2026-09-10')], september);
    expect(flow).toMatchObject({ newMembers: 0, renewals: 0 });
  });

  it('measures the renewal rate only on memberships whose grace has already run out, so the number is final', () => {
    const flow = membershipFlow(
      [
        // Ended 2 Sept, renewed in time.
        ms('a', '2026-08-03', '2026-09-02', '2026-08-03'),
        ms('a', '2026-09-03', '2026-10-02', '2026-09-03'),
        // Ended 5 Sept, grace passed with no renewal.
        ms('b', '2026-08-06', '2026-09-05', '2026-08-06'),
        // Ends 18 Sept: grace still open on the 20th, so not counted yet either way.
        ms('c', '2026-08-19', '2026-09-18', '2026-08-19'),
      ],
      september,
    );

    expect(flow.renewalRate).toEqual({ due: 2, renewed: 1, percent: 50 });
  });

  it('has no renewal rate when nothing has come due', () => {
    expect(membershipFlow([], september).renewalRate).toEqual({ due: 0, renewed: 0, percent: null });
  });
});
