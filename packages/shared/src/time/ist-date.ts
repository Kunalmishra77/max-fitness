import { TZDate } from '@date-fns/tz';
import type { Clock } from './clock';

/**
 * IST calendar dates.
 *
 * BR-1.1/1.2: the business timezone is Asia/Kolkata (UTC+5:30, no DST) and every
 * business date — `startDate`, `endDate`, `dob`, an attendance "day" — is a calendar
 * date, not an instant. Storing them as `Date` objects invites off-by-one bugs the
 * moment a server runs in UTC, so they are `"YYYY-MM-DD"` strings, branded so that a
 * plain string cannot be passed where a validated date is expected.
 *
 * Instants (payment time, message sent time) stay `Date` in UTC and are a different
 * thing entirely.
 */
export type ISTDate = string & { readonly __brand: 'ISTDate' };

/** `"HH:mm"` in IST, e.g. a reminder slot `"09:30"`. */
export type ISTTime = string & { readonly __brand: 'ISTTime' };

export const IST_TIME_ZONE = 'Asia/Kolkata';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

interface DateParts {
  readonly year: number;
  /** 1-12, not the 0-11 that `Date` uses. */
  readonly month: number;
  readonly day: number;
}

export class InvalidISTDateError extends Error {
  constructor(value: string) {
    super(`Not a valid IST calendar date (expected YYYY-MM-DD): ${JSON.stringify(value)}`);
    this.name = 'InvalidISTDateError';
  }
}

export class InvalidISTTimeError extends Error {
  constructor(value: string) {
    super(`Not a valid IST time of day (expected HH:mm, 00:00-23:59): ${JSON.stringify(value)}`);
    this.name = 'InvalidISTTimeError';
  }
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function format(parts: DateParts): ISTDate {
  return `${String(parts.year).padStart(4, '0')}-${pad2(parts.month)}-${pad2(parts.day)}` as ISTDate;
}

/** Days since the Unix epoch. Uses UTC arithmetic, so no DST can perturb it. */
function toEpochDay(parts: DateParts): number {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

function fromEpochDay(epochDay: number): DateParts {
  const d = new Date(epochDay * 86_400_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function parts(date: ISTDate): DateParts {
  const m = DATE_PATTERN.exec(date);
  /* c8 ignore next 3 -- unreachable for a branded value; guards a bad cast */
  if (!m) {
    throw new InvalidISTDateError(date);
  }
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** True when `value` is a real calendar date in `YYYY-MM-DD` form (rejects 2026-02-30). */
export function isISTDate(value: unknown): value is ISTDate {
  if (typeof value !== 'string') return false;
  const m = DATE_PATTERN.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

/** Parse and validate a `YYYY-MM-DD` string. Throws `InvalidISTDateError` if it is not one. */
export function istDate(value: string): ISTDate {
  if (!isISTDate(value)) {
    throw new InvalidISTDateError(value);
  }
  return value;
}

export function isISTTime(value: unknown): value is ISTTime {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

export function istTime(value: string): ISTTime {
  if (!isISTTime(value)) {
    throw new InvalidISTTimeError(value);
  }
  return value;
}

/** Build a date from its parts, validating the day against the month's length. */
export function istDateOf(year: number, month: number, day: number): ISTDate {
  return istDate(`${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`);
}

/** The IST calendar date an instant falls on. */
export function toISTDate(instant: Date): ISTDate {
  const zoned = new TZDate(instant.getTime(), IST_TIME_ZONE);
  return istDateOf(zoned.getFullYear(), zoned.getMonth() + 1, zoned.getDate());
}

/** The IST wall-clock time an instant falls on, as `"HH:mm"`. */
export function toISTTime(instant: Date): ISTTime {
  const zoned = new TZDate(instant.getTime(), IST_TIME_ZONE);
  return istTime(`${pad2(zoned.getHours())}:${pad2(zoned.getMinutes())}`);
}

/** Today's business date (BR-1.3). The clock is injected; never read the wall clock directly. */
export function todayIST(clock: Clock): ISTDate {
  return toISTDate(clock.now());
}

/** The current IST wall-clock time, for quiet-hours checks (BR-5.3 rule 5). */
export function nowISTTime(clock: Clock): ISTTime {
  return toISTTime(clock.now());
}

/** The UTC instant at which `slot` occurs on `date` in IST. Used to schedule reminder jobs. */
export function slotToUtc(date: ISTDate, slot: ISTTime): Date {
  const { year, month, day } = parts(date);
  const [hh, mm] = slot.split(':');
  const zoned = TZDate.tz(IST_TIME_ZONE, year, month - 1, day, Number(hh), Number(mm), 0, 0);
  return new Date(zoned.getTime());
}

export function addDays(date: ISTDate, days: number): ISTDate {
  return format(fromEpochDay(toEpochDay(parts(date)) + days));
}

/**
 * Add whole months, clamping to the end of the target month (BR-3.1).
 *
 * 31 Jan + 1 month is 28 Feb (or 29 Feb in a leap year), not 3 March.
 */
export function addMonthsClamped(date: ISTDate, months: number): ISTDate {
  const { year, month, day } = parts(date);
  const zeroBased = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(zeroBased / 12);
  const targetMonth = (zeroBased % 12) + 1;
  const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return format({ year: targetYear, month: targetMonth, day: clampedDay });
}

/** Whole days from `b` to `a`: positive when `a` is later. `diffDays(endDate, today)` is days left. */
export function diffDays(a: ISTDate, b: ISTDate): number {
  return toEpochDay(parts(a)) - toEpochDay(parts(b));
}

export function compareISTDates(a: ISTDate, b: ISTDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minISTDate(a: ISTDate, b: ISTDate): ISTDate {
  return a <= b ? a : b;
}

export function maxISTDate(a: ISTDate, b: ISTDate): ISTDate {
  return a >= b ? a : b;
}

/** Month (1-12) and day of an IST date — used for birthday matching (BR-8.1). */
export function monthDayOf(date: ISTDate): { month: number; day: number } {
  const { month, day } = parts(date);
  return { month, day };
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Indian financial year label for a date: 1 April - 31 March, written `"2026-27"`
 * (BR-1.4). Drives receipt numbering (BR-11.2).
 */
export function fyLabel(date: ISTDate): string {
  const { year, month } = parts(date);
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${pad2((startYear + 1) % 100)}`;
}

/** First day of the financial year containing `date`. */
export function fyStart(date: ISTDate): ISTDate {
  const { year, month } = parts(date);
  return istDateOf(month >= 4 ? year : year - 1, 4, 1);
}

/** Last day of the financial year containing `date`. */
export function fyEnd(date: ISTDate): ISTDate {
  const { year, month } = parts(date);
  return istDateOf(month >= 4 ? year + 1 : year, 3, 31);
}

/** Day of week in IST, 0 = Sunday. Attendance volume differs on Sundays (seed spec §5). */
export function dayOfWeek(date: ISTDate): number {
  const epochDay = toEpochDay(parts(date));
  // 1970-01-01 was a Thursday (4).
  return (((epochDay + 4) % 7) + 7) % 7;
}

/** Minutes since midnight, for comparing a time against a quiet-hours window. */
export function minutesOfDay(time: ISTTime): number {
  const [hh, mm] = time.split(':');
  return Number(hh) * 60 + Number(mm);
}
