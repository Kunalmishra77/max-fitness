import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HoursTable, type HoursTableRow } from './hours-table';

const rows: HoursTableRow[] = [
  { day: 1, label: 'Monday', hours: '4:30 am – 10:00 pm' },
  { day: 6, label: 'Saturday', hours: '4:30 am – 10:00 pm' },
  { day: 0, label: 'Sunday', hours: null },
];

function renderTable() {
  render(<HoursTable rows={rows} todayLabel="Today" closedLabel="Closed" />);
}

describe('HoursTable', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks today's row in India time, not the browser's time zone", () => {
    // 20:00 UTC on Saturday 12 Sep 2026 is already 01:30 on Sunday 13 Sep in IST.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-12T20:00:00Z'));
    renderTable();

    const sunday = screen.getByRole('row', { name: /Sunday/ });
    expect(sunday.getAttribute('aria-current')).toBe('date');
    expect(sunday.textContent).toContain('Today');
    expect(screen.getByRole('row', { name: /Saturday/ }).getAttribute('aria-current')).toBeNull();
  });

  it('shows the closed label for a closed day', () => {
    renderTable();
    expect(screen.getByRole('row', { name: /Sunday/ }).textContent).toContain('Closed');
  });

  it('marks exactly one row', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-14T05:00:00Z')); // Monday 10:30 IST
    renderTable();
    expect(screen.getAllByText('Today')).toHaveLength(1);
    expect(screen.getByRole('row', { name: /Monday/ }).getAttribute('aria-current')).toBe('date');
  });
});
