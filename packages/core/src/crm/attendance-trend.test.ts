import { describe, expect, it } from 'vitest';
import { toISTDate } from '@mfp/shared';
import { attendanceTrend } from './attendance-trend';

/**
 * The last week of arrivals, as something to look at (ADR-095).
 *
 * "23 came in today" says nothing on its own — 23 is good on a Sunday and poor on a
 * Monday. The point of the row of bars is the comparison, so the two things that would
 * ruin it are a missing day silently closing the gap, and a bar whose height is read
 * against a different scale than the one beside it.
 */

const day = (value: string) => toISTDate(new Date(`${value}T06:00:00+05:30`));

describe('attendanceTrend', () => {
  it('returns one bar per day, oldest first, ending today', () => {
    const trend = attendanceTrend({
      counts: [
        { date: day('2026-09-28'), count: 30 },
        { date: day('2026-09-30'), count: 12 },
      ],
      today: day('2026-09-30'),
      days: 3,
    });

    expect(trend.bars.map((bar) => bar.date)).toEqual([day('2026-09-28'), day('2026-09-29'), day('2026-09-30')]);
  });

  it('fills a day nobody came in as a zero rather than leaving it out', () => {
    // A closed Sunday is information. Dropping it would move Saturday next to Monday and
    // quietly turn a weekly pattern into a smooth line.
    const trend = attendanceTrend({ counts: [{ date: day('2026-09-28'), count: 30 }], today: day('2026-09-30'), days: 3 });
    expect(trend.bars.map((bar) => bar.count)).toEqual([30, 0, 0]);
  });

  it('scales every bar against the busiest day in the window, not against itself', () => {
    const trend = attendanceTrend({
      counts: [
        { date: day('2026-09-28'), count: 40 },
        { date: day('2026-09-29'), count: 10 },
        { date: day('2026-09-30'), count: 20 },
      ],
      today: day('2026-09-30'),
      days: 3,
    });

    expect(trend.busiest).toBe(40);
    expect(trend.bars.map((bar) => bar.height)).toEqual([100, 25, 50]);
  });

  it('draws nothing rather than dividing by zero in a week with no arrivals', () => {
    const trend = attendanceTrend({ counts: [], today: day('2026-09-30'), days: 3 });
    expect(trend.busiest).toBe(0);
    expect(trend.bars.map((bar) => bar.height)).toEqual([0, 0, 0]);
    expect(trend.total).toBe(0);
  });

  it('marks today, so the bar that is still filling up is not read as a finished one', () => {
    const trend = attendanceTrend({ counts: [{ date: day('2026-09-30'), count: 5 }], today: day('2026-09-30'), days: 3 });
    expect(trend.bars.map((bar) => bar.isToday)).toEqual([false, false, true]);
  });

  it('reports the week total and the daily average, both excluding today', () => {
    // Today is half-finished, so averaging it in makes every afternoon look like a slump.
    const trend = attendanceTrend({
      counts: [
        { date: day('2026-09-28'), count: 30 },
        { date: day('2026-09-29'), count: 10 },
        { date: day('2026-09-30'), count: 2 },
      ],
      today: day('2026-09-30'),
      days: 3,
    });

    expect(trend.total).toBe(42);
    expect(trend.averageBeforeToday).toBe(20);
  });

  it('ignores a count outside the window instead of drawing it somewhere wrong', () => {
    const trend = attendanceTrend({
      counts: [
        { date: day('2026-09-01'), count: 99 },
        { date: day('2026-09-30'), count: 4 },
      ],
      today: day('2026-09-30'),
      days: 3,
    });

    expect(trend.busiest).toBe(4);
    expect(trend.total).toBe(4);
  });
});
