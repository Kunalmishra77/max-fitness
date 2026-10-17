import { addDays, compareISTDates, diffDays, istDateOf, minISTDate, type ISTDate } from '@mfp/shared';
import { DomainError } from '../errors';
import { customRange, mondayOf, MAX_RANGE_DAYS } from '../attendance/history';
import { monthBoundsFor, type MonthBounds } from './reports';

/**
 * Reading the reports over something other than a calendar month (REP-001, REP-002).
 *
 * The screen had a month picker and nothing else, so "how did this week go" and "what did
 * the year come to" had no answer — the owner's two commonest questions after "what did
 * this month come to".
 *
 * **Every card's arithmetic is untouched.** The whole reports pipeline already takes a
 * `MonthBounds` — a window plus the window before it — and the fourteen cards compute from
 * that. So this produces exactly the same shape for a week, a year or a hand-picked range,
 * and the figures are the figures: no metric changes meaning, and `MONTH` delegates to the
 * existing `monthBoundsFor` so the behaviour there is byte-identical to before.
 *
 * **The comparison is like-for-like, and that is the only real judgement here.** Four days
 * of this week against all of last week reads as a collapse every Tuesday, so an unfinished
 * period is compared against the *same distance into* the one before it. The existing month
 * rule already did this with `previousToDate`; this extends it, measured in **elapsed
 * days** rather than by calendar date. That matters across a leap year: a year that is 60
 * days old should be compared with the first 60 days of the year before, not with a date
 * that may not exist.
 *
 * A **finished** period needs no such care and gets the whole previous one, because cutting
 * a complete period's comparison short would invent a fall that did not happen.
 */

export const REPORT_PERIODS = ['WEEK', 'MONTH', 'YEAR', 'CUSTOM'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export function isReportPeriod(value: unknown): value is ReportPeriod {
  return typeof value === 'string' && (REPORT_PERIODS as readonly string[]).includes(value);
}

/**
 * The window to report on, and the one to compare it against.
 *
 * `MonthBounds` is returned rather than a new type: it is already the shape every card
 * reads, and a parallel type would mean converting between two identical things.
 */
export function reportPeriodBounds(
  period: ReportPeriod,
  today: ISTDate,
  custom?: { readonly from: ISTDate; readonly to: ISTDate },
): MonthBounds {
  if (period === 'MONTH') {
    // Unchanged on purpose: the month view is what the owner already reads every day.
    return monthBoundsFor(today.slice(0, 7), today);
  }

  if (period === 'WEEK') {
    const start = mondayOf(today);
    return {
      start,
      // Not `today`: the window is the whole week, and the cards clip to it themselves,
      // exactly as the month view runs to the month's last day.
      end: addDays(start, 6),
      previousStart: addDays(start, -7),
      previousEnd: addDays(start, -1),
      previousToDate: addDays(addDays(start, -7), diffDays(today, start)),
    };
  }

  if (period === 'YEAR') {
    const year = Number(today.slice(0, 4));
    const start = istDateOf(year, 1, 1);
    const previousStart = istDateOf(year - 1, 1, 1);
    const previousEnd = istDateOf(year - 1, 12, 31);
    return {
      start,
      end: istDateOf(year, 12, 31),
      previousStart,
      previousEnd,
      // Elapsed days into the year, clamped so a leap year cannot run past 31 December.
      previousToDate: minISTDate(addDays(previousStart, diffDays(today, start)), previousEnd),
    };
  }

  if (custom === undefined) {
    throw new DomainError('VALIDATION_FAILED', 'A custom period needs two dates', { field: 'from' });
  }

  /**
   * A hand-picked range, compared against the equally long span immediately before it.
   *
   * Treated as finished — the owner chose the end date, so `previousToDate` is the whole
   * previous span. Clipping it to today would mean a range ending yesterday compared
   * against nothing.
   */
  const { from, to } = customRange(custom.from, custom.to, today);
  const length = diffDays(to, from) + 1;
  const previousEnd = addDays(from, -1);
  const previousStart = addDays(previousEnd, -(length - 1));

  return { start: from, end: to, previousStart, previousEnd, previousToDate: previousEnd };
}

/**
 * Read a period and its dates out of a query string.
 *
 * Everything here arrives in a URL, so it is whatever somebody typed. An unreadable period
 * falls back to the month, which is what the screen showed before this existed; a custom
 * period missing either date does the same rather than erroring, because a half-typed URL
 * is a mistake and not an attack. A range that is genuinely out of bounds — reversed, in
 * the future, longer than the ceiling — is `customRange`'s business and it says why.
 */
export function readReportPeriod(
  asked: { readonly period?: string | undefined; readonly from?: string | undefined; readonly to?: string | undefined },
  today: ISTDate,
): { readonly period: ReportPeriod; readonly bounds: MonthBounds; readonly problem: 'TOO_LONG' | 'FUTURE' | null } {
  const period = isReportPeriod(asked.period) ? asked.period : 'MONTH';

  if (period !== 'CUSTOM') {
    return { period, bounds: reportPeriodBounds(period, today), problem: null };
  }

  const from = asked.from;
  const to = asked.to;
  if (from === undefined || to === undefined || !isDate(from) || !isDate(to)) {
    return { period: 'MONTH', bounds: reportPeriodBounds('MONTH', today), problem: null };
  }

  try {
    return { period: 'CUSTOM', bounds: reportPeriodBounds('CUSTOM', today, { from, to }), problem: null };
  } catch (error) {
    const meta = (error as { meta?: { maxDays?: number } }).meta;
    return {
      period: 'MONTH',
      bounds: reportPeriodBounds('MONTH', today),
      problem: meta?.maxDays === MAX_RANGE_DAYS ? 'TOO_LONG' : 'FUTURE',
    };
  }
}

function isDate(value: string): value is ISTDate {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * The window the cards should actually be clipped to.
 *
 * A period runs to its own end — this week to Sunday, this year to 31 December — but the
 * days that have not happened must not be reported as zero. Returns the end, or today,
 * whichever is earlier.
 */
export function periodEndToDate(bounds: MonthBounds, today: ISTDate): ISTDate {
  return compareISTDates(bounds.end, today) > 0 ? today : bounds.end;
}
