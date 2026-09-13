import { addDays, isLeapYear, monthDayOf, type ISTDate, type MemberStatus } from '@mfp/shared';

/**
 * Birthdays (BR-8).
 *
 * The interesting case is 29 February. A member born on a leap day has a birthday
 * three years in four if you are careless about it; BR-8.1 says they celebrate on
 * 28 February in non-leap years, so they are greeted every year.
 */

export interface BirthdayCandidate {
  readonly dob: ISTDate | null;
  readonly status: MemberStatus;
}

/** BR-8.1, including the leap-day rule. */
export function isBirthdayToday(dob: ISTDate, today: ISTDate): boolean {
  const birth = monthDayOf(dob);
  const now = monthDayOf(today);

  if (birth.month === now.month && birth.day === now.day) {
    return true;
  }

  // Born 29 Feb, and today is 28 Feb in a year that has no 29th.
  if (birth.month === 2 && birth.day === 29 && now.month === 2 && now.day === 28) {
    return !isLeapYear(Number(today.slice(0, 4)));
  }

  return false;
}

/** BR-8.2: only ACTIVE members appear on the owner's birthday list. */
export function hasBirthdayToday(member: BirthdayCandidate, today: ISTDate): boolean {
  if (member.status !== 'ACTIVE' || member.dob === null) return false;
  return isBirthdayToday(member.dob, today);
}

/**
 * Days until the next birthday, or `null` if none falls within `maxDays`.
 *
 * Walks forward a day at a time rather than doing month/day arithmetic, so the
 * leap-day rule and the year boundary are handled by the same function that decides
 * "is it today" — one rule, one implementation.
 */
export function daysUntilBirthday(dob: ISTDate, today: ISTDate, maxDays = 366): number | null {
  for (let offset = 0; offset <= maxDays; offset += 1) {
    if (isBirthdayToday(dob, addDays(today, offset))) return offset;
  }
  return null;
}

/** The "birthdays this week" list: ACTIVE members with a birthday in the next `days` days. */
export function hasBirthdayWithin(member: BirthdayCandidate, today: ISTDate, days: number): boolean {
  if (member.status !== 'ACTIVE' || member.dob === null) return false;
  const until = daysUntilBirthday(member.dob, today, days);
  return until !== null && until <= days;
}
