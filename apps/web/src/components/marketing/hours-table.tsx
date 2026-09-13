'use client';

import { dayOfWeek, toISTDate } from '@mfp/shared/time';
import { useSyncExternalStore } from 'react';
import { cn } from '@/lib/cn';

/**
 * Opening hours with today's row highlighted (PRD LP-19).
 *
 * The page is served from a static cache (ADR-032), so "today" cannot be decided on the
 * server — a page cached on Saturday night is still served on Sunday morning. The table
 * renders without a highlight, and the browser marks today's row in Asia/Kolkata time
 * right after hydration. The highlight changes only a background and adds a short badge,
 * so nothing moves.
 */

export interface HoursTableRow {
  readonly day: number;
  readonly label: string;
  /** Formatted range, or `null` when closed that day. */
  readonly hours: string | null;
}

const neverChanges = () => () => {};

/** Today's weekday in IST (0 = Sunday); `null` during the static render and hydration. */
function useIstWeekday(): number | null {
  return useSyncExternalStore(neverChanges, () => dayOfWeek(toISTDate(new Date())), () => null);
}

export function HoursTable({
  rows,
  todayLabel,
  closedLabel,
}: {
  rows: readonly HoursTableRow[];
  todayLabel: string;
  closedLabel: string;
}) {
  const today = useIstWeekday();

  return (
    <table className="mt-4 w-full border-collapse text-body">
      <tbody>
        {rows.map((row) => {
          const isToday = row.day === today;
          return (
            <tr
              key={row.day}
              aria-current={isToday ? 'date' : undefined}
              className={cn('border-b border-brand-rubber-grey/20', isToday && 'bg-brand-white font-semibold')}
            >
              <th scope="row" className="py-3 pl-3 text-left font-medium whitespace-nowrap">
                {row.label}
                {isToday ? (
                  <span className="ml-2 rounded-button bg-brand-plate-navy px-2 py-0.5 text-small text-brand-chalk">
                    {todayLabel}
                  </span>
                ) : null}
              </th>
              <td className="tabular py-3 pr-3 text-right">{row.hours ?? closedLabel}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
