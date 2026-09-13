import { describe, expect, it } from 'vitest';
import { istDate, istTime } from '@mfp/shared';
import { dayPeriod, hoursForDay, toTwelveHour, todayStatus, weekHours, yearsOperating, type HoursRow } from './hours';

const row = (day: number, open: string, close: string, closed = false): HoursRow => ({
  day,
  open: istTime(open),
  close: istTime(close),
  closed,
});

// Mon–Sat 05:00–22:00, Sunday morning only.
const HOURS: HoursRow[] = [1, 2, 3, 4, 5, 6].map((d) => row(d, '05:00', '22:00')).concat(row(0, '06:00', '11:00'));

const THURSDAY = istDate('2026-09-10');
const SUNDAY = istDate('2026-09-13');

describe('todayStatus', () => {
  it('is open now between opening and closing', () => {
    expect(todayStatus(HOURS, THURSDAY, istTime('19:00'))).toEqual({ kind: 'OPEN_NOW', closesAt: '22:00' });
  });

  it('opens later before opening time', () => {
    expect(todayStatus(HOURS, THURSDAY, istTime('04:30'))).toEqual({ kind: 'OPENS_LATER', opensAt: '05:00', closesAt: '22:00' });
  });

  it('is closed for the day at and after closing time', () => {
    expect(todayStatus(HOURS, THURSDAY, istTime('22:00'))).toEqual({ kind: 'CLOSED_FOR_DAY' });
    expect(todayStatus(HOURS, THURSDAY, istTime('23:10'))).toEqual({ kind: 'CLOSED_FOR_DAY' });
  });

  it('opens exactly at opening time', () => {
    expect(todayStatus(HOURS, THURSDAY, istTime('05:00'))).toEqual({ kind: 'OPEN_NOW', closesAt: '22:00' });
  });

  it('uses the Sunday row on Sunday', () => {
    expect(todayStatus(HOURS, SUNDAY, istTime('10:00'))).toEqual({ kind: 'OPEN_NOW', closesAt: '11:00' });
    expect(todayStatus(HOURS, SUNDAY, istTime('12:00'))).toEqual({ kind: 'CLOSED_FOR_DAY' });
  });

  it('is closed today when the day is marked closed or missing', () => {
    expect(todayStatus([row(4, '05:00', '22:00', true)], THURSDAY, istTime('10:00'))).toEqual({ kind: 'CLOSED_TODAY' });
    expect(todayStatus([row(1, '05:00', '22:00')], THURSDAY, istTime('10:00'))).toEqual({ kind: 'CLOSED_TODAY' });
  });

  it('says nothing when no hours have been entered', () => {
    expect(todayStatus([], THURSDAY, istTime('10:00'))).toEqual({ kind: 'UNKNOWN' });
  });
});

describe('weekHours', () => {
  it('lists Monday first and marks today', () => {
    const rows = weekHours(HOURS, THURSDAY);
    expect(rows.map((r) => r.day)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(rows.filter((r) => r.isToday).map((r) => r.day)).toEqual([4]);
  });

  it('skips days with no row', () => {
    expect(weekHours([row(0, '06:00', '11:00')], SUNDAY)).toEqual([{ ...row(0, '06:00', '11:00'), isToday: true }]);
  });

  it('finds a row by day', () => {
    expect(hoursForDay(HOURS, 0)?.close).toBe('11:00');
    expect(hoursForDay([], 0)).toBeNull();
  });
});

describe('yearsOperating — LP-05, computed from 2000', () => {
  it('counts whole calendar years', () => {
    expect(yearsOperating(2000, istDate('2026-09-10'))).toBe(26);
    expect(yearsOperating(2000, istDate('2027-01-01'))).toBe(27);
  });

  it('never goes negative for a future year typed by mistake', () => {
    expect(yearsOperating(2030, istDate('2026-09-10'))).toBe(0);
  });
});

describe('toTwelveHour', () => {
  it('converts for "till 10 pm" style copy', () => {
    expect(toTwelveHour(istTime('22:00'))).toEqual({ hour: 10, minute: 0, meridiem: 'pm' });
    expect(toTwelveHour(istTime('05:30'))).toEqual({ hour: 5, minute: 30, meridiem: 'am' });
    expect(toTwelveHour(istTime('12:00'))).toEqual({ hour: 12, minute: 0, meridiem: 'pm' });
    expect(toTwelveHour(istTime('00:15'))).toEqual({ hour: 12, minute: 15, meridiem: 'am' });
  });
});

describe('dayPeriod — Hindi time phrasing', () => {
  it('maps hours to the part of the day people say', () => {
    expect(dayPeriod(istTime('05:00'))).toBe('morning');
    expect(dayPeriod(istTime('11:59'))).toBe('morning');
    expect(dayPeriod(istTime('12:00'))).toBe('afternoon');
    expect(dayPeriod(istTime('16:00'))).toBe('evening');
    expect(dayPeriod(istTime('19:00'))).toBe('night');
    expect(dayPeriod(istTime('22:00'))).toBe('night');
    expect(dayPeriod(istTime('02:00'))).toBe('night');
  });
});
