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

/** The first row for a day. Kept for callers that only need "is there a row at all". */
export function hoursForDay(hours: readonly HoursRow[], day: number): HoursRow | null {
  return hours.find((row) => row.day === day) ?? null;
}

/** One stretch the gym is open. A day may have more than one (ADR-082). */
export interface HoursSession {
  readonly open: ISTTime;
  readonly close: ISTTime;
}

/**
 * Every stretch the gym is open on a day, earliest first.
 *
 * Max Fitness opens twice: 4:30 to noon, shutters down, then 5 to 10. A single
 * open/close could only say "4:30 am – 10:00 pm", which tells a visitor the gym is open
 * at three in the afternoon when it is not. Settings hold one row per session, so a day
 * with two rows has two sessions and nothing else had to change to allow it.
 */
export function sessionsForDay(hours: readonly HoursRow[], day: number): HoursSession[] {
  return hours
    .filter((row) => row.day === day && !row.closed)
    .map((row) => ({ open: row.open, close: row.close }))
    .sort((a, b) => minutesOfDay(a.open) - minutesOfDay(b.open));
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
 * During the afternoon break this answers `OPENS_LATER` with the evening session, not
 * "closed" — a member told the gym is closed at three o'clock does not come back at six.
 *
 * `UNKNOWN` when the owner has not entered hours yet — the page then says nothing
 * rather than inventing a closing time (copy deck marks hours [VERIFY]).
 */
export function todayStatus(hours: readonly HoursRow[], today: ISTDate, now: ISTTime): TodayStatus {
  if (hours.length === 0) return { kind: 'UNKNOWN' };
  const sessions = sessionsForDay(hours, dayOfWeek(today));
  if (sessions.length === 0) return { kind: 'CLOSED_TODAY' };

  const at = minutesOfDay(now);
  for (const session of sessions) {
    if (at < minutesOfDay(session.open)) return { kind: 'OPENS_LATER', opensAt: session.open, closesAt: session.close };
    if (at < minutesOfDay(session.close)) return { kind: 'OPEN_NOW', closesAt: session.close };
  }
  return { kind: 'CLOSED_FOR_DAY' };
}

export interface DayHours {
  readonly day: number;
  readonly closed: boolean;
  /** Empty when closed. */
  readonly sessions: readonly HoursSession[];
}

/** One row per day in Monday-first order, carrying every session, today marked. */
export function weekHours(hours: readonly HoursRow[], today: ISTDate): Array<DayHours & { readonly isToday: boolean }> {
  const todayDay = dayOfWeek(today);
  return WEEK_DISPLAY_ORDER.filter((day) => hours.some((row) => row.day === day)).map((day) => {
    const sessions = sessionsForDay(hours, day);
    return { day, closed: sessions.length === 0, sessions, isToday: day === todayDay };
  });
}

export interface HoursGroup extends DayHours {
  /** Consecutive days in Monday-first order. */
  readonly days: readonly number[];
}

const sameSessions = (a: readonly HoursSession[], b: readonly HoursSession[]) =>
  a.length === b.length && a.every((session, i) => session.open === b[i]?.open && session.close === b[i]?.close);

/**
 * Consecutive days with identical hours, for a one-line summary such as
 * "Mon–Sat 4:30 am – 12:00 pm, 5:00 – 10:00 pm; Sun closed" in the footer and the FAQ.
 * A day missing from settings breaks a run rather than being guessed.
 */
export function groupHours(hours: readonly HoursRow[]): HoursGroup[] {
  const groups: Array<{ days: number[]; day: number; closed: boolean; sessions: HoursSession[] }> = [];
  let previousPosition = -2;

  WEEK_DISPLAY_ORDER.forEach((day, position) => {
    if (!hours.some((row) => row.day === day)) return;
    const sessions = sessionsForDay(hours, day);
    const closed = sessions.length === 0;

    const last = groups.at(-1);
    const alike = last !== undefined && last.closed === closed && (closed || sameSessions(last.sessions, sessions));

    if (last !== undefined && alike && previousPosition === position - 1) {
      last.days.push(day);
    } else {
      groups.push({ days: [day], day, closed, sessions });
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

/**
 * Which half of the day a member trains in (ADR-082).
 *
 * Worth asking only because this gym shuts between noon and five: the answer tells the
 * owner how many people are coming before work and how many after it, which is how they
 * decide when a trainer needs to be on the floor.
 *
 * It is a stored field, so the list itself lives beside the other stored enumerations in
 * `@mfp/shared` and is re-exported here, where the hours it refers to are computed.
 */
export { TRAINING_SLOTS, isTrainingSlot, type TrainingSlot } from '@mfp/shared';

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
