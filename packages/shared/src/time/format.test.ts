import { describe, expect, it } from 'vitest';
import { istDate } from './ist-date';
import { formatISTDate, formatISTDateTime } from './format';

describe('formatISTDate', () => {
  it('writes English dates day first with a three-letter month, as the copy deck does', () => {
    expect(formatISTDate(istDate('2026-09-11'), 'en')).toBe('11 Sep 2026');
    expect(formatISTDate(istDate('2027-03-01'), 'en')).toBe('1 Mar 2027');
  });

  it('leaves the year off when asked', () => {
    expect(formatISTDate(istDate('2026-12-09'), 'en', { year: false })).toBe('9 Dec');
  });

  it('writes Hindi dates with Hindi month names', () => {
    expect(formatISTDate(istDate('2026-09-11'), 'hi')).toMatch(/^11 सित/);
  });

  it('is the same calendar date wherever the browser is', () => {
    // A business date has no time of day; it must not shift for a visitor west of UTC.
    expect(formatISTDate(istDate('2026-01-01'), 'en')).toBe('1 Jan 2026');
  });
});

describe('formatISTDateTime', () => {
  it('shows an instant as the date and time in India', () => {
    expect(formatISTDateTime(new Date('2026-09-13T04:30:00.000Z'), 'en')).toBe('13 Sep 2026, 10:00 am');
    expect(formatISTDateTime(new Date('2026-09-13T13:05:00.000Z'), 'en')).toBe('13 Sep 2026, 6:35 pm');
    // 11:45 pm IST on the 13th is still the 13th, though it is the 13th 18:15 UTC.
    expect(formatISTDateTime(new Date('2026-09-13T18:15:00.000Z'), 'en')).toBe('13 Sep 2026, 11:45 pm');
    expect(formatISTDateTime(new Date('2026-09-13T18:35:00.000Z'), 'en')).toBe('14 Sep 2026, 12:05 am');
  });

  it('writes Hindi with Hindi month names', () => {
    expect(formatISTDateTime(new Date('2026-09-13T04:30:00.000Z'), 'hi')).toMatch(/^13 सित/);
  });
});
