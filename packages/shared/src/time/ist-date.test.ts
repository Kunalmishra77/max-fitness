import { describe, expect, it } from 'vitest';
import {
  FakeClock,
  addDays,
  addMonthsClamped,
  compareISTDates,
  dayOfWeek,
  diffDays,
  fyEnd,
  fyLabel,
  fyStart,
  isISTDate,
  isISTTime,
  isLeapYear,
  istDate,
  istDateOf,
  istTime,
  InvalidISTDateError,
  InvalidISTTimeError,
  maxISTDate,
  minISTDate,
  minutesOfDay,
  monthDayOf,
  nowISTTime,
  slotToUtc,
  toISTDate,
  toISTTime,
  todayIST,
} from './index';

const d = istDate;

describe('istDate / isISTDate', () => {
  it('accepts a real calendar date', () => {
    expect(isISTDate('2026-09-10')).toBe(true);
    expect(d('2026-09-10')).toBe('2026-09-10');
  });

  it('rejects a day that does not exist in that month', () => {
    expect(isISTDate('2026-02-30')).toBe(false);
    expect(isISTDate('2026-04-31')).toBe(false);
    expect(() => d('2026-02-30')).toThrow(InvalidISTDateError);
  });

  it('rejects 29 February in a non-leap year but accepts it in a leap year', () => {
    expect(isISTDate('2027-02-29')).toBe(false);
    expect(isISTDate('2028-02-29')).toBe(true);
  });

  it('rejects malformed input', () => {
    expect(isISTDate('10-09-2026')).toBe(false);
    expect(isISTDate('2026-9-10')).toBe(false);
    expect(isISTDate('2026-09-10T00:00:00Z')).toBe(false);
    expect(isISTDate('')).toBe(false);
    expect(isISTDate(20260910)).toBe(false);
    expect(isISTDate(null)).toBe(false);
    expect(isISTDate('2026-13-01')).toBe(false);
    expect(isISTDate('2026-00-01')).toBe(false);
  });

  it('builds a date from parts and validates it', () => {
    expect(istDateOf(2026, 9, 10)).toBe('2026-09-10');
    expect(() => istDateOf(2026, 2, 30)).toThrow(InvalidISTDateError);
  });
});

describe('istTime', () => {
  it('accepts a 24-hour time of day', () => {
    expect(istTime('00:00')).toBe('00:00');
    expect(istTime('09:30')).toBe('09:30');
    expect(istTime('23:59')).toBe('23:59');
  });

  it('rejects anything else', () => {
    expect(isISTTime('24:00')).toBe(false);
    expect(isISTTime('9:30')).toBe(false);
    expect(isISTTime('10:60')).toBe(false);
    expect(isISTTime(1000)).toBe(false);
    expect(() => istTime('24:00')).toThrow(InvalidISTTimeError);
  });

  it('converts to minutes since midnight', () => {
    expect(minutesOfDay(istTime('00:00'))).toBe(0);
    expect(minutesOfDay(istTime('09:30'))).toBe(570);
    expect(minutesOfDay(istTime('23:59'))).toBe(1439);
  });
});

describe('toISTDate — instants map to the IST calendar day, not the UTC one', () => {
  it('maps a UTC instant to the IST date', () => {
    // 18:30 UTC is 00:00 IST the next day (UTC+5:30).
    expect(toISTDate(new Date('2026-09-10T18:30:00Z'))).toBe('2026-09-11');
    expect(toISTDate(new Date('2026-09-10T18:29:59Z'))).toBe('2026-09-10');
  });

  it('handles the IST day boundary at both ends', () => {
    expect(toISTDate(new Date('2026-09-10T00:00:00Z'))).toBe('2026-09-10'); // 05:30 IST
    expect(toISTDate(new Date('2026-09-09T18:30:00Z'))).toBe('2026-09-10'); // 00:00 IST
  });

  it('reads the wall-clock time in IST', () => {
    expect(toISTTime(new Date('2026-09-10T04:30:00Z'))).toBe('10:00');
    expect(toISTTime(new Date('2026-09-10T18:29:00Z'))).toBe('23:59');
  });
});

describe('todayIST — BR-1.3, from the injected clock', () => {
  it('reads the date from the clock, not the wall clock', () => {
    const clock = new FakeClock(new Date('2026-09-10T04:30:00Z'));
    expect(todayIST(clock)).toBe('2026-09-10');
    expect(nowISTTime(clock)).toBe('10:00');
  });

  it('rolls over at 18:30 UTC', () => {
    const clock = new FakeClock(new Date('2026-09-10T18:29:00Z'));
    expect(todayIST(clock)).toBe('2026-09-10');
    clock.advanceMinutes(1);
    expect(todayIST(clock)).toBe('2026-09-11');
  });

  it('advances by days, hours and minutes', () => {
    const clock = new FakeClock(new Date('2026-09-10T04:30:00Z'));
    clock.advanceDays(2);
    expect(todayIST(clock)).toBe('2026-09-12');
    clock.advanceHours(24);
    expect(todayIST(clock)).toBe('2026-09-13');
    clock.set(new Date('2027-01-01T04:30:00Z'));
    expect(todayIST(clock)).toBe('2027-01-01');
  });
});

describe('slotToUtc — reminder slots are IST wall-clock times', () => {
  it('converts a slot to the correct UTC instant', () => {
    expect(slotToUtc(d('2026-09-10'), istTime('10:00')).toISOString()).toBe('2026-09-10T04:30:00.000Z');
    expect(slotToUtc(d('2026-09-10'), istTime('09:30')).toISOString()).toBe('2026-09-10T04:00:00.000Z');
    expect(slotToUtc(d('2026-09-10'), istTime('19:00')).toISOString()).toBe('2026-09-10T13:30:00.000Z');
  });

  it('has no daylight saving discontinuity — IST never shifts', () => {
    // Northern-hemisphere DST changeover dates; the offset must stay +5:30.
    expect(slotToUtc(d('2026-03-29'), istTime('10:00')).toISOString()).toBe('2026-03-29T04:30:00.000Z');
    expect(slotToUtc(d('2026-10-25'), istTime('10:00')).toISOString()).toBe('2026-10-25T04:30:00.000Z');
  });

  it('round-trips through toISTDate', () => {
    const instant = slotToUtc(d('2026-09-10'), istTime('00:00'));
    expect(toISTDate(instant)).toBe('2026-09-10');
  });
});

describe('addMonthsClamped — BR-3.1', () => {
  it('adds a whole month when the day exists in the target month', () => {
    expect(addMonthsClamped(d('2026-09-10'), 1)).toBe('2026-10-10');
    expect(addMonthsClamped(d('2026-01-15'), 3)).toBe('2026-04-15');
  });

  it('clamps to the end of a shorter month', () => {
    expect(addMonthsClamped(d('2027-01-31'), 1)).toBe('2027-02-28');
    expect(addMonthsClamped(d('2028-01-31'), 1)).toBe('2028-02-29'); // leap year
    expect(addMonthsClamped(d('2026-03-31'), 1)).toBe('2026-04-30');
    expect(addMonthsClamped(d('2026-05-31'), 1)).toBe('2026-06-30');
  });

  it('crosses a year boundary', () => {
    expect(addMonthsClamped(d('2026-12-15'), 1)).toBe('2027-01-15');
    expect(addMonthsClamped(d('2026-09-10'), 12)).toBe('2027-09-10');
    expect(addMonthsClamped(d('2026-11-30'), 15)).toBe('2028-02-29');
  });

  it('subtracts months too', () => {
    expect(addMonthsClamped(d('2026-03-31'), -1)).toBe('2026-02-28');
    expect(addMonthsClamped(d('2026-01-15'), -1)).toBe('2025-12-15');
    expect(addMonthsClamped(d('2026-01-15'), -13)).toBe('2024-12-15');
  });

  it('adding zero months is the identity', () => {
    expect(addMonthsClamped(d('2026-09-10'), 0)).toBe('2026-09-10');
  });
});

describe('addDays / diffDays', () => {
  it('adds and subtracts days across month and year boundaries', () => {
    expect(addDays(d('2026-09-10'), 1)).toBe('2026-09-11');
    expect(addDays(d('2026-09-30'), 1)).toBe('2026-10-01');
    expect(addDays(d('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addDays(d('2026-01-01'), -1)).toBe('2025-12-31');
    expect(addDays(d('2028-02-28'), 1)).toBe('2028-02-29');
    expect(addDays(d('2027-02-28'), 1)).toBe('2027-03-01');
    expect(addDays(d('2026-09-10'), 0)).toBe('2026-09-10');
  });

  it('measures whole days between dates, signed', () => {
    expect(diffDays(d('2026-09-17'), d('2026-09-10'))).toBe(7);
    expect(diffDays(d('2026-09-10'), d('2026-09-10'))).toBe(0);
    expect(diffDays(d('2026-09-09'), d('2026-09-10'))).toBe(-1);
    expect(diffDays(d('2027-09-10'), d('2026-09-10'))).toBe(365);
    expect(diffDays(d('2029-03-01'), d('2028-03-01'))).toBe(365);
    expect(diffDays(d('2028-03-01'), d('2027-03-01'))).toBe(366); // spans 29 Feb 2028
  });

  it('is consistent with addDays over a long span', () => {
    const start = d('2026-01-01');
    for (const n of [1, 29, 100, 365, 1000]) {
      expect(diffDays(addDays(start, n), start)).toBe(n);
    }
  });
});

describe('comparison helpers', () => {
  it('orders dates lexicographically, which for YYYY-MM-DD is chronological', () => {
    expect(compareISTDates(d('2026-09-10'), d('2026-09-11'))).toBe(-1);
    expect(compareISTDates(d('2026-09-11'), d('2026-09-10'))).toBe(1);
    expect(compareISTDates(d('2026-09-10'), d('2026-09-10'))).toBe(0);
    expect(minISTDate(d('2026-09-10'), d('2026-01-01'))).toBe('2026-01-01');
    expect(maxISTDate(d('2026-09-10'), d('2026-01-01'))).toBe('2026-09-10');
  });
});

describe('fyLabel / fyStart / fyEnd — BR-1.4, 1 April to 31 March', () => {
  it('labels a date in the second half of the calendar year with its own year first', () => {
    expect(fyLabel(d('2026-09-10'))).toBe('2026-27');
    expect(fyLabel(d('2026-04-01'))).toBe('2026-27');
    expect(fyLabel(d('2026-12-31'))).toBe('2026-27');
  });

  it('labels January to March with the previous year first', () => {
    expect(fyLabel(d('2027-01-01'))).toBe('2026-27');
    expect(fyLabel(d('2027-03-31'))).toBe('2026-27');
  });

  it('rolls to the next financial year on 1 April', () => {
    expect(fyLabel(d('2027-04-01'))).toBe('2027-28');
  });

  it('pads a single-digit end year', () => {
    expect(fyLabel(d('2008-05-01'))).toBe('2008-09');
    expect(fyLabel(d('2009-02-01'))).toBe('2008-09');
  });

  it('gives the boundaries of the financial year', () => {
    expect(fyStart(d('2026-09-10'))).toBe('2026-04-01');
    expect(fyEnd(d('2026-09-10'))).toBe('2027-03-31');
    expect(fyStart(d('2027-03-31'))).toBe('2026-04-01');
    expect(fyEnd(d('2027-03-31'))).toBe('2027-03-31');
    expect(fyStart(d('2027-04-01'))).toBe('2027-04-01');
  });
});

describe('calendar helpers', () => {
  it('extracts month and day for birthday matching', () => {
    expect(monthDayOf(d('2000-02-29'))).toEqual({ month: 2, day: 29 });
    expect(monthDayOf(d('2026-09-10'))).toEqual({ month: 9, day: 10 });
  });

  it('identifies leap years, including the century rule', () => {
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2027)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it('gives the day of week with Sunday as 0', () => {
    expect(dayOfWeek(d('2026-09-10'))).toBe(4); // Thursday
    expect(dayOfWeek(d('2026-09-13'))).toBe(0); // Sunday
    expect(dayOfWeek(d('1970-01-01'))).toBe(4); // Thursday
    expect(dayOfWeek(d('1969-12-31'))).toBe(3); // Wednesday — negative epoch day
  });
});
