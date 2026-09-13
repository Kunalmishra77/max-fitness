import { istDate, type ISTDate } from '@mfp/shared';

/**
 * Business dates at the database edge (CLAUDE.md §2.2).
 *
 * `@db.Date` columns carry no time zone. Prisma reads and writes them as a `Date` at
 * UTC midnight, so the calendar date is the ISO date part of that instant — never a
 * local-time conversion, which would shift it by a day west of UTC.
 */
export function toDbDate(date: ISTDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function fromDbDate(value: Date): ISTDate {
  return istDate(value.toISOString().slice(0, 10));
}
