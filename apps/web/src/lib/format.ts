import { dayPeriod, toTwelveHour, type HoursRow } from '@mfp/core';
import { formatINR, type ISTTime } from '@mfp/shared';

/**
 * Server-side formatting helpers for landing-page copy.
 *
 * These import from packages/core, which pulls in Node-only modules, so they are for
 * server components; client components receive already-formatted strings as props.
 */

/** Values for the `visit.time` message: "10:00 pm" in English, "रात 10:00" in Hindi. */
export function timeValues(time: ISTTime): { hour: string; minute: string; meridiem: 'am' | 'pm'; period: string } {
  const { hour, minute, meridiem } = toTwelveHour(time);
  return { hour: String(hour), minute: String(minute).padStart(2, '0'), meridiem, period: dayPeriod(time) };
}

type TimeTranslator = (key: 'time', values: ReturnType<typeof timeValues>) => string;

export function formatTime(t: TimeTranslator, time: ISTTime): string {
  return t('time', timeValues(time));
}

/** Whole-rupee price for display. Money stays integer paise everywhere else. */
export function price(paise: number): string {
  return formatINR(paise, { showPaise: false });
}

export type { HoursRow };
