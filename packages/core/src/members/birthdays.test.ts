import { describe, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import { daysUntilBirthday, hasBirthdayToday, hasBirthdayWithin, isBirthdayToday } from './birthdays';

const d = istDate;

describe('isBirthdayToday — BR-8.1', () => {
  it('matches on month and day, ignoring the year', () => {
    expect(isBirthdayToday(d('1990-09-10'), d('2026-09-10'))).toBe(true);
    expect(isBirthdayToday(d('1990-09-11'), d('2026-09-10'))).toBe(false);
    expect(isBirthdayToday(d('1990-10-10'), d('2026-09-10'))).toBe(false);
  });

  it('matches a birthday in the same year as today', () => {
    expect(isBirthdayToday(d('2026-09-10'), d('2026-09-10'))).toBe(true);
  });

  it('celebrates a 29 February birthday on 28 February in a non-leap year', () => {
    expect(isBirthdayToday(d('2008-02-29'), d('2027-02-28'))).toBe(true);
    expect(isBirthdayToday(d('2008-02-29'), d('2026-02-28'))).toBe(true);
  });

  it('celebrates it on the 29th when there is one', () => {
    expect(isBirthdayToday(d('2008-02-29'), d('2028-02-29'))).toBe(true);
  });

  it('does not double-celebrate in a leap year — the 28th is not their day', () => {
    expect(isBirthdayToday(d('2008-02-29'), d('2028-02-28'))).toBe(false);
  });

  it('leaves a 28 February birthday alone in both kinds of year', () => {
    expect(isBirthdayToday(d('2008-02-28'), d('2027-02-28'))).toBe(true);
    expect(isBirthdayToday(d('2008-02-28'), d('2028-02-28'))).toBe(true);
    expect(isBirthdayToday(d('2008-02-28'), d('2028-02-29'))).toBe(false);
  });

  it('honours the century rule for leap years', () => {
    // 1900 was not a leap year; 2000 was.
    expect(isBirthdayToday(d('1896-02-29'), d('1900-02-28'))).toBe(true);
    expect(isBirthdayToday(d('1996-02-29'), d('2000-02-28'))).toBe(false);
  });
});

describe('hasBirthdayToday — BR-8.2, ACTIVE members only', () => {
  const today = d('2026-09-10');

  it('includes an active member', () => {
    expect(hasBirthdayToday({ dob: d('1990-09-10'), status: 'ACTIVE' }, today)).toBe(true);
  });

  it('excludes every other status — we do not wish happy birthday to someone who left', () => {
    for (const status of ['LEFT', 'BLOCKED', 'PENDING_PAYMENT', 'PENDING_VERIFICATION'] as const) {
      expect(hasBirthdayToday({ dob: d('1990-09-10'), status }, today), status).toBe(false);
    }
  });

  it('excludes a member with no date of birth on record', () => {
    expect(hasBirthdayToday({ dob: null, status: 'ACTIVE' }, today)).toBe(false);
  });
});

describe('daysUntilBirthday', () => {
  it('is zero on the day', () => {
    expect(daysUntilBirthday(d('1990-09-10'), d('2026-09-10'))).toBe(0);
  });

  it('counts forward within the month and across the year end', () => {
    expect(daysUntilBirthday(d('1990-09-13'), d('2026-09-10'))).toBe(3);
    expect(daysUntilBirthday(d('1990-01-05'), d('2026-12-30'))).toBe(6);
  });

  it('finds a leap-day birthday at its 28 February observance', () => {
    expect(daysUntilBirthday(d('2008-02-29'), d('2027-02-25'))).toBe(3);
  });

  it('returns null when nothing falls inside the window', () => {
    expect(daysUntilBirthday(d('1990-12-25'), d('2026-09-10'), 7)).toBeNull();
  });
});

describe('hasBirthdayWithin — the "this week" list', () => {
  const today = d('2026-09-10');

  it('includes a birthday inside the window', () => {
    expect(hasBirthdayWithin({ dob: d('1990-09-13'), status: 'ACTIVE' }, today, 6)).toBe(true);
  });

  it('includes today itself', () => {
    expect(hasBirthdayWithin({ dob: d('1990-09-10'), status: 'ACTIVE' }, today, 6)).toBe(true);
  });

  it('excludes one just past the window', () => {
    expect(hasBirthdayWithin({ dob: d('1990-09-17'), status: 'ACTIVE' }, today, 6)).toBe(false);
  });

  it('excludes inactive members and those with no DOB', () => {
    expect(hasBirthdayWithin({ dob: d('1990-09-13'), status: 'LEFT' }, today, 6)).toBe(false);
    expect(hasBirthdayWithin({ dob: null, status: 'ACTIVE' }, today, 6)).toBe(false);
  });
});
