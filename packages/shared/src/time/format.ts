import type { ISTDate } from './ist-date';

/**
 * A business date for people to read (copy deck: "10 Sep – 9 Dec 2026").
 *
 * English is built by hand because ICU disagrees with itself: `en` puts the month first
 * and `en-IN` abbreviates September as "Sept". Hindi uses the platform's `hi-IN` month
 * names. The date is formatted as a UTC calendar date, so it reads the same in any
 * browser time zone.
 */

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export function formatISTDate(date: ISTDate, locale: string, options: { year?: boolean } = {}): string {
  const withYear = options.year ?? true;
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];

  if (locale !== 'hi') {
    return `${day} ${EN_MONTHS[month - 1] ?? ''}${withYear ? ` ${year}` : ''}`;
  }
  return new Intl.DateTimeFormat('hi-IN', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** India has kept UTC+05:30 all year since 1945, with no daylight saving. */
const IST_OFFSET_MS = 330 * 60_000;

/** An instant (a reservation deadline) as the date and time in India: "13 Sep 2026, 10:00 am". */
export function formatISTDateTime(instant: Date, locale: string): string {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  const date = shifted.toISOString().slice(0, 10) as ISTDate;
  const hours = shifted.getUTCHours();
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');

  if (locale !== 'hi') {
    return `${formatISTDate(date, 'en')}, ${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? 'am' : 'pm'}`;
  }
  const time = new Intl.DateTimeFormat('hi-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(instant);
  return `${formatISTDate(date, 'hi')}, ${time}`;
}
