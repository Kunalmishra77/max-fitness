import { addDays, addMonthsClamped, compareISTDates, dayOfWeek, diffDays, istDateOf, type ISTDate } from '@mfp/shared';
import { DomainError } from '../errors';

/**
 * Looking at attendance that is not today's (ATT-001 … ATT-005).
 *
 * The screen only ever showed the current day, so the register the gym has been building
 * since the kiosk went in was unreadable from the CRM — nobody could answer "how many came
 * last Tuesday", let alone "was October busier than September".
 *
 * Every date decision lives here, pure and with a date passed in rather than read from a
 * clock (CLAUDE.md §2.2, §2.4). The reason is not purity for its own sake: these are the
 * calculations that go quietly wrong at a month boundary, in a leap year, or in the week
 * that straddles New Year, and the only way to be sure is to be able to ask them directly.
 *
 * **The week starts on Monday.** A gym's week does — Sunday is its own kind of day here,
 * which the seed spec already notes — and `dayOfWeek` counts from Sunday, so every
 * conversion goes through `mondayOf` rather than being done by hand twice.
 */

export const ATTENDANCE_PRESETS = [
  'TODAY',
  'YESTERDAY',
  'THIS_WEEK',
  'LAST_WEEK',
  'THIS_MONTH',
  'LAST_MONTH',
  'THIS_YEAR',
  'LAST_YEAR',
  'CUSTOM',
] as const;
export type AttendancePreset = (typeof ATTENDANCE_PRESETS)[number];

export function isAttendancePreset(value: unknown): value is AttendancePreset {
  return typeof value === 'string' && (ATTENDANCE_PRESETS as readonly string[]).includes(value);
}

/**
 * An inclusive reporting window.
 *
 * Named apart from `DateRange` in `membership/dates`, which is a membership's cover and
 * has a nullable start — a different thing that happens to hold two dates.
 */
export interface AttendanceRange {
  readonly from: ISTDate;
  readonly to: ISTDate;
}

/**
 * The longest span a single query or export may cover.
 *
 * Two years is more than the gym has data for and far more than anybody reads in one
 * screen; the point is that a hand-typed range cannot ask for the whole table.
 */
export const MAX_RANGE_DAYS = 732;

/** The Monday of the week `date` falls in. */
export function mondayOf(date: ISTDate): ISTDate {
  // `dayOfWeek` is 0 = Sunday, so Sunday is six days *after* its Monday, not one before.
  const weekday = dayOfWeek(date);
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

/** The first day of the month `date` falls in. */
export function firstOfMonth(date: ISTDate): ISTDate {
  const [year, month] = date.split('-').map(Number) as [number, number, number];
  return istDateOf(year, month, 1);
}

/**
 * The last day of the month `date` falls in.
 *
 * Via the first of the next month rather than a table of lengths, so February needs no
 * special case and a leap year needs no thought.
 */
export function lastOfMonth(date: ISTDate): ISTDate {
  return addDays(firstOfMonth(addMonthsClamped(firstOfMonth(date), 1)), -1);
}

/**
 * Turn a preset into dates.
 *
 * Ranges are inclusive at both ends and **never run past today**: a calendar that offers
 * "this month" and then reports zero visits for the rest of it is reporting the future as
 * an empty gym. `CUSTOM` is not a preset with an answer — the caller supplies the dates —
 * so asking for it here is a programming error rather than a user one.
 */
export function rangeForPreset(preset: Exclude<AttendancePreset, 'CUSTOM'>, today: ISTDate): AttendanceRange {
  switch (preset) {
    case 'TODAY':
      return { from: today, to: today };
    case 'YESTERDAY': {
      const yesterday = addDays(today, -1);
      return { from: yesterday, to: yesterday };
    }
    case 'THIS_WEEK':
      return { from: mondayOf(today), to: today };
    case 'LAST_WEEK': {
      const monday = addDays(mondayOf(today), -7);
      return { from: monday, to: addDays(monday, 6) };
    }
    case 'THIS_MONTH':
      return { from: firstOfMonth(today), to: today };
    case 'LAST_MONTH': {
      const inLastMonth = addDays(firstOfMonth(today), -1);
      return { from: firstOfMonth(inLastMonth), to: inLastMonth };
    }
    case 'THIS_YEAR': {
      const [year] = today.split('-').map(Number) as [number, number, number];
      return { from: istDateOf(year, 1, 1), to: today };
    }
    case 'LAST_YEAR': {
      const [year] = today.split('-').map(Number) as [number, number, number];
      return { from: istDateOf(year - 1, 1, 1), to: istDateOf(year - 1, 12, 31) };
    }
  }
}

/**
 * Validate a range somebody typed.
 *
 * Reversed dates are corrected rather than refused — somebody filling two date fields on
 * a phone gets them the wrong way round often enough that refusing is just rude, and the
 * intent is unambiguous. A range reaching into the future is clipped to today for the same
 * reason the presets are. A span beyond `MAX_RANGE_DAYS` is refused, because that one is
 * not a slip: it is a query nobody wants the answer to.
 */
export function customRange(from: ISTDate, to: ISTDate, today: ISTDate): AttendanceRange {
  const [start, end] = compareISTDates(from, to) <= 0 ? [from, to] : [to, from];
  const clipped = compareISTDates(end, today) > 0 ? today : end;

  if (compareISTDates(start, clipped) > 0) {
    // The whole range is in the future: there is nothing to show and no sane clipping.
    throw new DomainError('VALIDATION_FAILED', 'That range has not happened yet', { field: 'from' });
  }
  if (diffDays(clipped, start) + 1 > MAX_RANGE_DAYS) {
    throw new DomainError('VALIDATION_FAILED', 'That range is too long', { field: 'from', maxDays: MAX_RANGE_DAYS });
  }
  return { from: start, to: clipped };
}

/** One day's worth of the register, as the database groups it. */
export interface DailyCount {
  readonly date: ISTDate;
  readonly visits: number;
  readonly members: number;
}

export interface CalendarCell {
  readonly date: ISTDate;
  readonly visits: number;
  /** False for the leading and trailing days that only fill the grid out to whole weeks. */
  readonly inMonth: boolean;
  /** Nothing has happened yet, which is not the same as nobody came. */
  readonly isFuture: boolean;
  readonly isToday: boolean;
}

/**
 * A month as whole Monday-to-Sunday weeks.
 *
 * Padded at both ends so every row has seven cells, which is what lets the grid be laid
 * out without a pile of empty-cell special cases. The padding days carry `inMonth: false`
 * and are drawn faintly rather than left blank, because a blank corner reads as a bug.
 *
 * `isFuture` is deliberately separate from `visits: 0`. "Nobody came" and "this day has
 * not happened" look identical in a count and must not look identical on a calendar — the
 * first is worth a phone call and the second is Tuesday.
 */
export function monthCalendar(month: ISTDate, today: ISTDate, counts: readonly DailyCount[]): CalendarCell[][] {
  const visitsByDate = new Map(counts.map((row) => [row.date, row.visits]));
  const first = firstOfMonth(month);
  const last = lastOfMonth(month);
  const gridStart = mondayOf(first);
  // Pad to the Sunday of the final week.
  const lastWeekday = dayOfWeek(last);
  const gridEnd = addDays(last, lastWeekday === 0 ? 0 : 7 - lastWeekday);

  const weeks: CalendarCell[][] = [];
  let cursor = gridStart;
  while (compareISTDates(cursor, gridEnd) <= 0) {
    const week: CalendarCell[] = [];
    for (let day = 0; day < 7; day++) {
      week.push({
        date: cursor,
        visits: visitsByDate.get(cursor) ?? 0,
        inMonth: compareISTDates(cursor, first) >= 0 && compareISTDates(cursor, last) <= 0,
        isFuture: compareISTDates(cursor, today) > 0,
        isToday: cursor === today,
      });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export interface AttendanceStats {
  readonly visits: number;
  /** Days on which anybody came at all. */
  readonly activeDays: number;
  /** Days in the range that have actually happened. */
  readonly elapsedDays: number;
  readonly busiest: DailyCount | null;
  /** Visits per elapsed day, to one decimal place. */
  readonly averagePerDay: number;
}

/**
 * Totals for a range.
 *
 * The average is over **elapsed** days rather than days with visits. Dividing by active
 * days answers "how busy were the busy days", which flatters a quiet month into looking
 * like a steady one; dividing by elapsed days answers the question the owner is actually
 * asking. The future is excluded from the denominator for the same reason — a month
 * averaged over its whole length on the 3rd reads as a collapse.
 *
 * `members` is not summed. One member coming on ten days is ten visits and one member,
 * and adding the daily unique counts together would claim ten people; the unique figure
 * over a range can only come from the database.
 */
export function attendanceStats(range: AttendanceRange, today: ISTDate, counts: readonly DailyCount[]): AttendanceStats {
  const visits = counts.reduce((sum, row) => sum + row.visits, 0);
  const activeDays = counts.filter((row) => row.visits > 0).length;

  const end = compareISTDates(range.to, today) > 0 ? today : range.to;
  const elapsedDays = compareISTDates(range.from, end) > 0 ? 0 : diffDays(end, range.from) + 1;

  const busiest = counts.reduce<DailyCount | null>(
    (best, row) => (row.visits > 0 && (best === null || row.visits > best.visits) ? row : best),
    null,
  );

  return {
    visits,
    activeDays,
    elapsedDays,
    busiest,
    averagePerDay: elapsedDays === 0 ? 0 : Math.round((visits / elapsedDays) * 10) / 10,
  };
}

/**
 * Fill in the days the database said nothing about.
 *
 * A `GROUP BY` returns no row for a day with no visits, so a chart drawn straight from it
 * silently closes the gaps and shows a quiet Sunday as though it never existed. Every day
 * in the range gets a row; days after today are left out rather than drawn as zero.
 */
export function fillMissingDays(range: AttendanceRange, today: ISTDate, counts: readonly DailyCount[]): DailyCount[] {
  const byDate = new Map(counts.map((row) => [row.date, row]));
  const end = compareISTDates(range.to, today) > 0 ? today : range.to;

  const filled: DailyCount[] = [];
  for (let cursor = range.from; compareISTDates(cursor, end) <= 0; cursor = addDays(cursor, 1)) {
    filled.push(byDate.get(cursor) ?? { date: cursor, visits: 0, members: 0 });
  }
  return filled;
}
