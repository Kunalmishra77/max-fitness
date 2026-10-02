import { addDays, type ISTDate } from '@mfp/shared';

/**
 * The last week of arrivals, as something to look at (ADR-095).
 *
 * "23 came in today" says nothing on its own: 23 is good on a Sunday and poor on a Monday.
 * The owner reads the shape, not the number — a row of bars answers "is it busier or
 * quieter than usual?" in less time than it takes to read a sentence.
 *
 * Two decisions keep the picture honest. **A day nobody came in is a zero, not a gap**:
 * dropping it would move Saturday next to Monday and turn a weekly rhythm into a smooth
 * line. And **every bar is scaled against the busiest day in the window**, so heights can
 * be compared by eye, which is the only reason to draw them at all.
 *
 * The average deliberately **leaves today out**. Today is half-finished; averaging it in
 * makes every afternoon look like a slump and would have the owner chasing a problem that
 * is only the clock.
 */

export interface AttendanceBar {
  readonly date: ISTDate;
  readonly count: number;
  /** 0–100, against the busiest day in the window, for a CSS height. */
  readonly height: number;
  readonly isToday: boolean;
}

export interface AttendanceTrend {
  readonly bars: readonly AttendanceBar[];
  readonly busiest: number;
  readonly total: number;
  /** The daily average over the window excluding today, rounded. */
  readonly averageBeforeToday: number;
}

export function attendanceTrend(input: {
  readonly counts: ReadonlyArray<{ readonly date: ISTDate; readonly count: number }>;
  readonly today: ISTDate;
  readonly days: number;
}): AttendanceTrend {
  const byDate = new Map(input.counts.map((row) => [row.date, row.count]));

  // Oldest first, ending today: the eye reads left to right and expects now on the right.
  const dates = Array.from({ length: input.days }, (_, index) => addDays(input.today, index - (input.days - 1)));
  const counts = dates.map((date) => byDate.get(date) ?? 0);
  const busiest = counts.reduce((most, count) => Math.max(most, count), 0);

  const bars = dates.map((date, index) => ({
    date,
    count: counts[index] ?? 0,
    // A week with nobody in it draws nothing rather than dividing by zero.
    height: busiest === 0 ? 0 : Math.round(((counts[index] ?? 0) / busiest) * 100),
    isToday: date === input.today,
  }));

  const before = bars.filter((bar) => !bar.isToday);
  const beforeTotal = before.reduce((sum, bar) => sum + bar.count, 0);

  return {
    bars,
    busiest,
    total: counts.reduce((sum, count) => sum + count, 0),
    averageBeforeToday: before.length === 0 ? 0 : Math.round(beforeTotal / before.length),
  };
}
