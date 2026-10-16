import { describe, expect, it } from 'vitest';
import { istDate, type ISTDate } from '@mfp/shared';
import { DomainError } from '../errors';
import {
  attendanceStats,
  customRange,
  fillMissingDays,
  firstOfMonth,
  isAttendancePreset,
  lastOfMonth,
  MAX_RANGE_DAYS,
  mondayOf,
  monthCalendar,
  rangeForPreset,
  type DailyCount,
} from './history';

const d = (value: string): ISTDate => istDate(value);

describe('mondayOf', () => {
  /**
   * `dayOfWeek` counts from Sunday, so Sunday is six days *after* its Monday rather than
   * one before it. Getting that backwards moves a whole week's figures by seven days and
   * is invisible unless the boundary is asserted directly.
   */
  it('treats Sunday as the end of its week, not the start of the next', () => {
    // 2026-10-18 is a Sunday; its Monday is the 12th.
    expect(mondayOf(d('2026-10-18'))).toBe('2026-10-12');
  });

  it('leaves a Monday alone', () => {
    expect(mondayOf(d('2026-10-12'))).toBe('2026-10-12');
  });

  it('crosses a month backwards when the week straddles one', () => {
    // Thursday 1 October 2026 → Monday 28 September.
    expect(mondayOf(d('2026-10-01'))).toBe('2026-09-28');
  });

  it('crosses a year backwards', () => {
    // Friday 1 January 2027 → Monday 28 December 2026.
    expect(mondayOf(d('2027-01-01'))).toBe('2026-12-28');
  });
});

describe('firstOfMonth / lastOfMonth', () => {
  it('finds both ends of an ordinary month', () => {
    expect(firstOfMonth(d('2026-10-16'))).toBe('2026-10-01');
    expect(lastOfMonth(d('2026-10-16'))).toBe('2026-10-31');
  });

  it('handles the 30-day months', () => {
    expect(lastOfMonth(d('2026-09-15'))).toBe('2026-09-30');
    expect(lastOfMonth(d('2026-11-01'))).toBe('2026-11-30');
  });

  it('handles February in a common year and a leap year', () => {
    expect(lastOfMonth(d('2026-02-10'))).toBe('2026-02-28');
    expect(lastOfMonth(d('2028-02-10'))).toBe('2028-02-29');
  });

  it('handles December without rolling the year wrong', () => {
    expect(lastOfMonth(d('2026-12-05'))).toBe('2026-12-31');
  });
});

describe('rangeForPreset', () => {
  // A Friday, chosen so week and month boundaries are both non-trivial.
  const today = d('2026-10-16');

  it('today and yesterday are single days', () => {
    expect(rangeForPreset('TODAY', today)).toEqual({ from: '2026-10-16', to: '2026-10-16' });
    expect(rangeForPreset('YESTERDAY', today)).toEqual({ from: '2026-10-15', to: '2026-10-15' });
  });

  /**
   * "This week" and "this month" stop at today. A range that runs to the end of the
   * period reports the days that have not happened yet as an empty gym, which drags
   * every average down and reads as a collapse in business.
   */
  it('stops this week and this month at today rather than at the period end', () => {
    expect(rangeForPreset('THIS_WEEK', today)).toEqual({ from: '2026-10-12', to: '2026-10-16' });
    expect(rangeForPreset('THIS_MONTH', today)).toEqual({ from: '2026-10-01', to: '2026-10-16' });
    expect(rangeForPreset('THIS_YEAR', today)).toEqual({ from: '2026-01-01', to: '2026-10-16' });
  });

  it('gives the completed periods their whole span', () => {
    expect(rangeForPreset('LAST_WEEK', today)).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(rangeForPreset('LAST_MONTH', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(rangeForPreset('LAST_YEAR', today)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('gets last month right from the first of a month', () => {
    // The off-by-one that turns "last month" into "this month" on the 1st.
    expect(rangeForPreset('LAST_MONTH', d('2026-10-01'))).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('gets last month right when the previous month is shorter', () => {
    // 31 March back to February: a naive "subtract one month" lands on 31 February.
    expect(rangeForPreset('LAST_MONTH', d('2026-03-31'))).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('gets last week right from a Monday', () => {
    expect(rangeForPreset('LAST_WEEK', d('2026-10-12'))).toEqual({ from: '2026-10-05', to: '2026-10-11' });
  });

  it('gets last week right from a Sunday', () => {
    expect(rangeForPreset('LAST_WEEK', d('2026-10-18'))).toEqual({ from: '2026-10-05', to: '2026-10-11' });
  });

  it('handles the first of January, where every "this" range is one day', () => {
    expect(rangeForPreset('THIS_MONTH', d('2026-01-01'))).toEqual({ from: '2026-01-01', to: '2026-01-01' });
    expect(rangeForPreset('THIS_YEAR', d('2026-01-01'))).toEqual({ from: '2026-01-01', to: '2026-01-01' });
    expect(rangeForPreset('LAST_YEAR', d('2026-01-01'))).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });
});

describe('isAttendancePreset', () => {
  it('accepts the presets and refuses anything else from a query string', () => {
    expect(isAttendancePreset('THIS_MONTH')).toBe(true);
    expect(isAttendancePreset('CUSTOM')).toBe(true);
    for (const bad of ['this_month', 'ALL_TIME', '', null, 7, {}]) {
      expect(isAttendancePreset(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('customRange', () => {
  const today = d('2026-10-16');

  it('keeps a sane range as it is', () => {
    expect(customRange(d('2026-09-01'), d('2026-09-30'), today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  /** Two date fields on a phone get filled the wrong way round; the intent is obvious. */
  it('corrects a reversed range instead of refusing it', () => {
    expect(customRange(d('2026-09-30'), d('2026-09-01'), today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('clips an end date in the future back to today', () => {
    expect(customRange(d('2026-10-01'), d('2026-12-31'), today)).toEqual({ from: '2026-10-01', to: '2026-10-16' });
  });

  it('refuses a range entirely in the future, which cannot be clipped into sense', () => {
    expect(() => customRange(d('2026-11-01'), d('2026-11-30'), today)).toThrow(DomainError);
  });

  it('accepts a range exactly at the limit and refuses one day more', () => {
    // `MAX_RANGE_DAYS` is inclusive of both ends.
    const from = d('2025-01-01');
    const atLimit = customRange(from, d('2026-10-16'), d('2027-01-01'));
    expect(atLimit.from).toBe('2025-01-01');

    expect(() => customRange(d('2020-01-01'), d('2026-10-16'), today)).toThrow(/too long/);
  });

  it('names the limit in the error, so the screen can say what it is', () => {
    const error = (() => {
      try {
        customRange(d('2020-01-01'), d('2026-10-16'), today);
        return null;
      } catch (e) {
        return e as DomainError;
      }
    })();
    expect((error?.meta as { maxDays?: number })?.maxDays).toBe(MAX_RANGE_DAYS);
  });
});

describe('monthCalendar', () => {
  const today = d('2026-10-16');
  const counts: DailyCount[] = [
    { date: d('2026-10-01'), visits: 12, members: 11 },
    { date: d('2026-10-16'), visits: 4, members: 4 },
  ];

  it('returns whole Monday-to-Sunday weeks', () => {
    const weeks = monthCalendar(d('2026-10-16'), today, counts);
    for (const week of weeks) expect(week).toHaveLength(7);
    expect(weeks[0]?.[0]?.date).toBe('2026-09-28');
    expect(weeks.at(-1)?.at(-1)?.date).toBe('2026-11-01');
  });

  it('covers every day of the month exactly once', () => {
    const weeks = monthCalendar(d('2026-10-16'), today, counts);
    const inMonth = weeks.flat().filter((cell) => cell.inMonth);
    expect(inMonth).toHaveLength(31);
    expect(new Set(inMonth.map((cell) => cell.date)).size).toBe(31);
  });

  it('marks the padding days as outside the month', () => {
    const weeks = monthCalendar(d('2026-10-16'), today, counts);
    expect(weeks[0]?.[0]).toMatchObject({ date: '2026-09-28', inMonth: false });
  });

  it('attaches the counts to their days and leaves the rest at zero', () => {
    const cells = monthCalendar(d('2026-10-16'), today, counts).flat();
    expect(cells.find((c) => c.date === '2026-10-01')?.visits).toBe(12);
    expect(cells.find((c) => c.date === '2026-10-02')?.visits).toBe(0);
  });

  /**
   * The distinction the calendar exists to draw. A day with nobody on it is worth a
   * phone call; a day that has not happened is Tuesday. Both are `visits: 0`.
   */
  it('tells a day with nobody apart from a day that has not happened', () => {
    const cells = monthCalendar(d('2026-10-16'), today, counts).flat();
    expect(cells.find((c) => c.date === '2026-10-02')).toMatchObject({ visits: 0, isFuture: false });
    expect(cells.find((c) => c.date === '2026-10-17')).toMatchObject({ visits: 0, isFuture: true });
    expect(cells.find((c) => c.date === '2026-10-16')).toMatchObject({ isToday: true, isFuture: false });
  });

  it('handles a month that begins on a Monday without a blank leading week', () => {
    // June 2026 begins on a Monday.
    const weeks = monthCalendar(d('2026-06-10'), d('2026-06-30'), []);
    expect(weeks[0]?.[0]?.date).toBe('2026-06-01');
  });

  it('handles February in a leap year', () => {
    const weeks = monthCalendar(d('2028-02-10'), d('2028-03-01'), []);
    expect(weeks.flat().filter((c) => c.inMonth)).toHaveLength(29);
  });
});

describe('attendanceStats', () => {
  const today = d('2026-10-16');

  it('totals the visits and finds the busiest day', () => {
    const counts: DailyCount[] = [
      { date: d('2026-10-14'), visits: 10, members: 9 },
      { date: d('2026-10-15'), visits: 22, members: 20 },
      { date: d('2026-10-16'), visits: 7, members: 7 },
    ];
    const stats = attendanceStats({ from: d('2026-10-14'), to: d('2026-10-16') }, today, counts);

    expect(stats.visits).toBe(39);
    expect(stats.activeDays).toBe(3);
    expect(stats.elapsedDays).toBe(3);
    expect(stats.busiest).toMatchObject({ date: '2026-10-15', visits: 22 });
    expect(stats.averagePerDay).toBe(13);
  });

  /**
   * The average is over elapsed days, not active ones. Dividing by active days answers
   * "how busy were the busy days", which flatters a quiet month into a steady one.
   */
  it('averages over elapsed days, counting the empty ones', () => {
    const counts: DailyCount[] = [{ date: d('2026-10-14'), visits: 10, members: 10 }];
    const stats = attendanceStats({ from: d('2026-10-12'), to: d('2026-10-16') }, today, counts);

    expect(stats.elapsedDays).toBe(5);
    expect(stats.activeDays).toBe(1);
    expect(stats.averagePerDay).toBe(2);
  });

  it('excludes the future from the denominator, so an early month is not a collapse', () => {
    // "This month" on the 3rd: three days elapsed, not thirty-one.
    const counts: DailyCount[] = [
      { date: d('2026-10-01'), visits: 10, members: 10 },
      { date: d('2026-10-02'), visits: 10, members: 10 },
      { date: d('2026-10-03'), visits: 10, members: 10 },
    ];
    const stats = attendanceStats({ from: d('2026-10-01'), to: d('2026-10-31') }, d('2026-10-03'), counts);

    expect(stats.elapsedDays).toBe(3);
    expect(stats.averagePerDay).toBe(10);
  });

  it('says nothing rather than zero when there is no busiest day', () => {
    const stats = attendanceStats({ from: d('2026-10-01'), to: d('2026-10-16') }, today, []);
    expect(stats.busiest).toBeNull();
    expect(stats.visits).toBe(0);
    expect(stats.averagePerDay).toBe(0);
  });

  it('does not divide by zero for a range that has not started', () => {
    const stats = attendanceStats({ from: d('2026-11-01'), to: d('2026-11-30') }, today, []);
    expect(stats.elapsedDays).toBe(0);
    expect(stats.averagePerDay).toBe(0);
  });
});

describe('fillMissingDays', () => {
  const today = d('2026-10-16');

  /**
   * A `GROUP BY` returns no row for a day nobody came, so a chart drawn straight from it
   * closes the gap and shows a quiet Sunday as though it never happened.
   */
  it('gives every elapsed day in the range a row', () => {
    const filled = fillMissingDays({ from: d('2026-10-12'), to: d('2026-10-16') }, today, [
      { date: d('2026-10-13'), visits: 9, members: 8 },
    ]);

    expect(filled.map((row) => row.date)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
    expect(filled[0]).toEqual({ date: '2026-10-12', visits: 0, members: 0 });
    expect(filled[1]).toMatchObject({ visits: 9 });
  });

  it('stops at today rather than drawing the rest of the month as zero', () => {
    const filled = fillMissingDays({ from: d('2026-10-15'), to: d('2026-10-31') }, today, []);
    expect(filled.map((row) => row.date)).toEqual(['2026-10-15', '2026-10-16']);
  });

  it('returns nothing for a range that has not started', () => {
    expect(fillMissingDays({ from: d('2026-11-01'), to: d('2026-11-30') }, today, [])).toEqual([]);
  });
});
