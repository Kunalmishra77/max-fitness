import { describe, expect, it } from 'vitest';
import { istDate, type ISTDate } from '@mfp/shared';
import { DomainError } from '../errors';
import { monthBoundsFor } from './reports';
import { isReportPeriod, periodEndToDate, readReportPeriod, reportPeriodBounds } from './period';

const d = (value: string): ISTDate => istDate(value);

/** A Friday: week, month and year boundaries are all non-trivial from here. */
const TODAY = d('2026-10-16');

describe('reportPeriodBounds — MONTH is unchanged', () => {
  /**
   * The contract that matters most. Fourteen cards of money, renewals and churn already
   * compute from these bounds, and the owner reads the month view every day — so adding
   * other periods must not move a single figure in it.
   */
  it('delegates to monthBoundsFor, byte for byte', () => {
    expect(reportPeriodBounds('MONTH', TODAY)).toEqual(monthBoundsFor('2026-10', TODAY));
  });

  it('still keeps the like-for-like rule mid-month', () => {
    const bounds = reportPeriodBounds('MONTH', TODAY);
    // 16 days into October, so 16 days into September.
    expect(bounds.previousToDate).toBe('2026-09-16');
    expect(bounds.previousStart).toBe('2026-09-01');
  });
});

describe('reportPeriodBounds — WEEK', () => {
  const bounds = reportPeriodBounds('WEEK', TODAY);

  it('runs Monday to Sunday of the current week', () => {
    expect(bounds.start).toBe('2026-10-12');
    expect(bounds.end).toBe('2026-10-18');
  });

  it('compares against the whole week before', () => {
    expect(bounds.previousStart).toBe('2026-10-05');
    expect(bounds.previousEnd).toBe('2026-10-11');
  });

  /** Four days against seven reads as a collapse every Tuesday. */
  it('cuts the comparison to the same distance into last week', () => {
    // Friday is 4 days after Monday, so last Friday.
    expect(bounds.previousToDate).toBe('2026-10-09');
  });

  it('compares a Monday against one day of last week, not none', () => {
    const monday = reportPeriodBounds('WEEK', d('2026-10-12'));
    expect(monday.previousToDate).toBe('2026-10-05');
  });

  it('compares a Sunday against the whole of last week', () => {
    const sunday = reportPeriodBounds('WEEK', d('2026-10-18'));
    expect(sunday.previousToDate).toBe('2026-10-11');
    expect(sunday.previousToDate).toBe(sunday.previousEnd);
  });

  it('crosses a month backwards without losing the week', () => {
    // Thursday 1 October: its Monday is 28 September.
    const bounds = reportPeriodBounds('WEEK', d('2026-10-01'));
    expect(bounds.start).toBe('2026-09-28');
    expect(bounds.previousStart).toBe('2026-09-21');
  });

  it('crosses a year backwards', () => {
    const bounds = reportPeriodBounds('WEEK', d('2027-01-01'));
    expect(bounds.start).toBe('2026-12-28');
    expect(bounds.previousStart).toBe('2026-12-21');
  });
});

describe('reportPeriodBounds — YEAR', () => {
  const bounds = reportPeriodBounds('YEAR', TODAY);

  it('runs the whole calendar year', () => {
    expect(bounds.start).toBe('2026-01-01');
    expect(bounds.end).toBe('2026-12-31');
  });

  it('compares against the whole year before', () => {
    expect(bounds.previousStart).toBe('2025-01-01');
    expect(bounds.previousEnd).toBe('2025-12-31');
  });

  it('cuts the comparison to the same number of days into last year', () => {
    // 2026-10-16 is day 289 of 2026; the same elapsed offset in 2025.
    expect(bounds.previousToDate).toBe('2025-10-16');
  });

  /**
   * Measured in elapsed days rather than by calendar date, so a leap year has nowhere to
   * fall over: 29 February has no counterpart in the year before.
   */
  it('handles 29 February without asking for a date that does not exist', () => {
    const leap = reportPeriodBounds('YEAR', d('2028-02-29'));
    // Day 60 of 2028 → the 60th day of 2027, which is 1 March.
    expect(leap.previousToDate).toBe('2027-03-01');
  });

  it('never runs the comparison past 31 December', () => {
    const endOfLeapYear = reportPeriodBounds('YEAR', d('2028-12-31'));
    expect(endOfLeapYear.previousToDate).toBe('2027-12-31');
  });

  it('compares 1 January against one day of last year', () => {
    const bounds = reportPeriodBounds('YEAR', d('2026-01-01'));
    expect(bounds.previousToDate).toBe('2025-01-01');
  });
});

describe('reportPeriodBounds — CUSTOM', () => {
  it('compares against the equally long span immediately before', () => {
    const bounds = reportPeriodBounds('CUSTOM', TODAY, { from: d('2026-09-01'), to: d('2026-09-30') });

    expect(bounds.start).toBe('2026-09-01');
    expect(bounds.end).toBe('2026-09-30');
    // 30 days before, ending the day before it starts.
    expect(bounds.previousEnd).toBe('2026-08-31');
    expect(bounds.previousStart).toBe('2026-08-02');
  });

  it('treats a chosen range as finished, so the comparison is whole', () => {
    // The owner picked the end date; clipping would compare a range ending yesterday
    // against nothing.
    const bounds = reportPeriodBounds('CUSTOM', TODAY, { from: d('2026-10-01'), to: d('2026-10-07') });
    expect(bounds.previousToDate).toBe(bounds.previousEnd);
  });

  it('handles a single day against the day before', () => {
    const bounds = reportPeriodBounds('CUSTOM', TODAY, { from: d('2026-10-15'), to: d('2026-10-15') });
    expect(bounds.previousStart).toBe('2026-10-14');
    expect(bounds.previousEnd).toBe('2026-10-14');
  });

  it('refuses a custom period with no dates', () => {
    expect(() => reportPeriodBounds('CUSTOM', TODAY)).toThrow(DomainError);
  });

  it('inherits the range rules — reversed dates are corrected', () => {
    const bounds = reportPeriodBounds('CUSTOM', TODAY, { from: d('2026-09-30'), to: d('2026-09-01') });
    expect(bounds.start).toBe('2026-09-01');
    expect(bounds.end).toBe('2026-09-30');
  });
});

describe('readReportPeriod', () => {
  it('falls back to the month for an unreadable period', () => {
    // What the screen showed before any of this existed.
    for (const period of [undefined, '', 'week', 'ALL_TIME', 'QUARTER']) {
      const read = readReportPeriod({ period }, TODAY);
      expect(read.period, String(period)).toBe('MONTH');
      expect(read.problem).toBeNull();
    }
  });

  it('reads the three fixed periods', () => {
    for (const period of ['WEEK', 'MONTH', 'YEAR'] as const) {
      expect(readReportPeriod({ period }, TODAY).period).toBe(period);
    }
  });

  it('reads a custom period with both dates', () => {
    const read = readReportPeriod({ period: 'CUSTOM', from: '2026-09-01', to: '2026-09-30' }, TODAY);
    expect(read.period).toBe('CUSTOM');
    expect(read.bounds.start).toBe('2026-09-01');
  });

  it('falls back quietly when a custom period is missing a date', () => {
    // A half-typed URL is a mistake, not an attack: show the month rather than an error.
    for (const asked of [{ period: 'CUSTOM' }, { period: 'CUSTOM', from: '2026-09-01' }, { period: 'CUSTOM', to: '2026-09-30' }]) {
      const read = readReportPeriod(asked, TODAY);
      expect(read.period).toBe('MONTH');
      expect(read.problem).toBeNull();
    }
  });

  it('falls back and says why for a range that is too long', () => {
    const read = readReportPeriod({ period: 'CUSTOM', from: '2020-01-01', to: '2026-10-16' }, TODAY);
    expect(read.period).toBe('MONTH');
    expect(read.problem).toBe('TOO_LONG');
  });

  it('falls back and says why for a range that has not happened', () => {
    const read = readReportPeriod({ period: 'CUSTOM', from: '2026-11-01', to: '2026-11-30' }, TODAY);
    expect(read.period).toBe('MONTH');
    expect(read.problem).toBe('FUTURE');
  });

  it('ignores a malformed date rather than treating it as a range', () => {
    const read = readReportPeriod({ period: 'CUSTOM', from: 'yesterday', to: '2026-09-30' }, TODAY);
    expect(read.period).toBe('MONTH');
  });
});

describe('isReportPeriod', () => {
  it('accepts the four periods and nothing else', () => {
    for (const good of ['WEEK', 'MONTH', 'YEAR', 'CUSTOM']) expect(isReportPeriod(good)).toBe(true);
    for (const bad of ['week', 'DAY', '', null, 7, {}]) expect(isReportPeriod(bad), JSON.stringify(bad)).toBe(false);
  });
});

describe('periodEndToDate', () => {
  /** A period runs to its own end; the days that have not happened are not zero. */
  it('clips a running period to today', () => {
    expect(periodEndToDate(reportPeriodBounds('WEEK', TODAY), TODAY)).toBe('2026-10-16');
    expect(periodEndToDate(reportPeriodBounds('YEAR', TODAY), TODAY)).toBe('2026-10-16');
  });

  it('leaves a finished period at its own end', () => {
    const bounds = reportPeriodBounds('CUSTOM', TODAY, { from: d('2026-09-01'), to: d('2026-09-30') });
    expect(periodEndToDate(bounds, TODAY)).toBe('2026-09-30');
  });
});
