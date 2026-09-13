import { describe, expect, it } from 'vitest';
import { istTime } from '@mfp/shared';
import { groupHours, type HoursRow } from './hours';

const row = (day: number, open: string, close: string, closed = false): HoursRow => ({
  day,
  open: istTime(open),
  close: istTime(close),
  closed,
});

describe('groupHours', () => {
  it('returns nothing when no hours are set', () => {
    expect(groupHours([])).toEqual([]);
  });

  it('joins Monday to Saturday and keeps a different Sunday apart', () => {
    const hours = [1, 2, 3, 4, 5, 6].map((day) => row(day, '05:00', '22:00')).concat(row(0, '06:00', '12:00'));
    const groups = groupHours(hours);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ days: [1, 2, 3, 4, 5, 6], open: '05:00', close: '22:00', closed: false });
    expect(groups[1]).toMatchObject({ days: [0], open: '06:00', close: '12:00' });
  });

  it('lists days in Monday-first order whatever order settings store them in', () => {
    const hours = [row(0, '05:00', '22:00'), row(2, '05:00', '22:00'), row(1, '05:00', '22:00')];
    expect(groupHours(hours).map((group) => group.days)).toEqual([[1, 2], [0]]);
  });

  it('groups closed days together regardless of their stored times', () => {
    const hours = [row(5, '05:00', '22:00'), row(6, '00:00', '00:00', true), row(0, '09:00', '10:00', true)];
    const groups = groupHours(hours);
    expect(groups).toHaveLength(2);
    expect(groups[1]).toMatchObject({ days: [6, 0], closed: true });
  });

  it('does not bridge a day missing from settings', () => {
    const hours = [row(1, '05:00', '22:00'), row(3, '05:00', '22:00')];
    expect(groupHours(hours).map((group) => group.days)).toEqual([[1], [3]]);
  });

  it('splits a run when the closing time changes', () => {
    const hours = [row(1, '05:00', '22:00'), row(2, '05:00', '21:00')];
    expect(groupHours(hours)).toHaveLength(2);
  });
});
