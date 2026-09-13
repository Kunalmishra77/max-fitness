import { dayOfWeek, minutesOfDay, type ISTDate, type ISTTime } from '@mfp/shared';

/**
 * Opening hours and "how long we've been here" (PRD LP-05, LP-19).
 *
 * The trust strip says "Open today till 10 pm", the visit section highlights today's
 * row, and About says "26 years in Indirapuram". All three are facts derived from
 * settings and the date, so they are computed here — never in a component — and the
 * year count moves on its own every 1 January.
 */

export interface HoursRow {
  /** 0 = Sunday … 6 = Saturday. */
  readonly day: number;
  readonly open: ISTTime;
  readonly close: ISTTime;
  readonly closed: boolean;
}

/** Monday-first display order, as Indian gyms print their timings. */
export const WEEK_DISPLAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

export function hoursForDay(hours: readonly HoursRow[], day: number): HoursRow | null {
  return hours.find((row) => row.day === day) ?? null;
}

export type TodayStatus =
  | { readonly kind: 'OPEN_NOW'; readonly closesAt: ISTTime }
  | { readonly kind: 'OPENS_LATER'; readonly opensAt: ISTTime; readonly closesAt: ISTTime }
  | { readonly kind: 'CLOSED_FOR_DAY' }
  | { readonly kind: 'CLOSED_TODAY' }
  | { readonly kind: 'UNKNOWN' };

/**
 * What to say about today, at a given IST time.
 *
 * `UNKNOWN` when the owner has not entered hours yet — the page then says nothing
 * rather than inventing a closing time (copy deck marks hours [VERIFY]).
 */
export function todayStatus(hours: readonly HoursRow[], today: ISTDate, now: ISTTime): TodayStatus {
  if (hours.length === 0) return { kind: 'UNKNOWN' };
  const row = hoursForDay(hours, dayOfWeek(today));
  if (row === null || row.closed) return { kind: 'CLOSED_TODAY' };

  const at = minutesOfDay(now);
  if (at < minutesOfDay(row.open)) return { kind: 'OPENS_LATER', opensAt: row.open, closesAt: row.close };
  if (at < minutesOfDay(row.close)) return { kind: 'OPEN_NOW', closesAt: row.close };
  return { kind: 'CLOSED_FOR_DAY' };
}

/** Rows in Monday-first order with today's row marked, for the hours table. */
export function weekHours(
  hours: readonly HoursRow[],
  today: ISTDate,
): Array<HoursRow & { readonly isToday: boolean }> {
  const todayDay = dayOfWeek(today);
  return WEEK_DISPLAY_ORDER.map((day) => hoursForDay(hours, day))
    .filter((row): row is HoursRow => row !== null)
    .map((row) => ({ ...row, isToday: row.day === todayDay }));
}

export interface HoursGroup {
  /** Consecutive days in Monday-first order. */
  readonly days: readonly number[];
  readonly open: ISTTime;
  readonly close: ISTTime;
  readonly closed: boolean;
}

/**
 * Consecutive days with identical hours, for a one-line summary such as
 * "Mon–Sat 5:00 am – 10:00 pm; Sun closed" in the footer and the FAQ.
 * A day missing from settings breaks a run rather than being guessed.
 */
export function groupHours(hours: readonly HoursRow[]): HoursGroup[] {
  const groups: Array<{ days: number[]; open: ISTTime; close: ISTTime; closed: boolean }> = [];
  let previousPosition = -2;

  WEEK_DISPLAY_ORDER.forEach((day, position) => {
    const row = hoursForDay(hours, day);
    if (row === null) return;

    const last = groups.at(-1);
    const sameHours =
      last !== undefined &&
      last.closed === row.closed &&
      (row.closed || (last.open === row.open && last.close === row.close));

    if (last !== undefined && sameHours && previousPosition === position - 1) {
      last.days.push(day);
    } else {
      groups.push({ days: [day], open: row.open, close: row.close, closed: row.closed });
    }
    previousPosition = position;
  });

  return groups;
}

/** "Since 2000" → 26 in 2026. Never negative, whatever a typo in settings says. */
export function yearsOperating(establishedYear: number, today: ISTDate): number {
  return Math.max(0, Number(today.slice(0, 4)) - establishedYear);
}

/** `"22:00"` → `{ hour: 10, minute: 0, meridiem: 'pm' }`, for "till 10 pm" style copy. */
export function toTwelveHour(time: ISTTime): { hour: number; minute: number; meridiem: 'am' | 'pm' } {
  const total = minutesOfDay(time);
  const h24 = Math.floor(total / 60);
  const minute = total % 60;
  const meridiem = h24 >= 12 ? 'pm' : 'am';
  const hour = h24 % 12 === 0 ? 12 : h24 % 12;
  return { hour, minute, meridiem };
}

export type DayPeriod = 'morning' | 'afternoon' | 'evening' | 'night';

/**
 * Part of the day, for Hindi time phrasing ("सुबह 5:00", "रात 10:00") where am/pm
 * reads unnaturally. Boundaries follow everyday usage: morning until noon, afternoon
 * until 4 pm, evening until 7 pm, night after.
 */
export function dayPeriod(time: ISTTime): DayPeriod {
  const hour = Math.floor(minutesOfDay(time) / 60);
  if (hour >= 4 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 16) return 'afternoon';
  if (hour >= 16 && hour < 19) return 'evening';
  return 'night';
}
