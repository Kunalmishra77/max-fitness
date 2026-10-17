import Link from 'next/link';
import type { CalendarCell } from '@mfp/core';
import { cn } from '@/lib/cn';

/**
 * A month of attendance as a calendar (ATT-001, ATT-002).
 *
 * A server component with no JavaScript: every day is a link and the month arrows are
 * links, so this works on a reception phone with a bad connection and the back button
 * behaves. The shape of a month is not interactive — it is a table of dates — and making
 * it a client component would ship a grid renderer to do what an anchor already does.
 *
 * **Four states, not two.** A day is shaded by how busy it was, but "nobody came" and
 * "this day has not happened" are drawn differently on purpose: a Tuesday with nobody on
 * it is worth a phone call, and the 25th in the middle of the month is just Tuesday. The
 * core decides which is which; this only colours them.
 *
 * Intensity is relative to the busiest day **in the month shown**, not an absolute scale.
 * A gym with twelve visits a day and one with two hundred both want to see their own
 * shape, and a fixed scale would render the first as uniformly blank.
 */

export interface AttendanceCalendarProps {
  readonly weeks: readonly (readonly CalendarCell[])[];
  readonly selected: string;
  /** `YYYY-MM-DD` in the previous and next months; null when that month is in the future. */
  readonly previousMonth: string | null;
  readonly nextMonth: string | null;
  readonly monthLabel: string;
  readonly weekdayLabels: readonly string[];
  readonly previousLabel: string;
  readonly nextLabel: string;
  readonly todayLabel: string;
  readonly today: string;
  /** Builds the href for a date, so the page keeps whatever else is in its query string. */
  readonly hrefFor: (date: string) => string;
  readonly visitsLabel: (visits: number) => string;
}

export function AttendanceCalendar({
  weeks,
  selected,
  previousMonth,
  nextMonth,
  monthLabel,
  weekdayLabels,
  previousLabel,
  nextLabel,
  todayLabel,
  today,
  hrefFor,
  visitsLabel,
}: AttendanceCalendarProps) {
  const busiest = Math.max(1, ...weeks.flat().map((cell) => cell.visits));

  return (
    <section aria-label={monthLabel} className="px-4 pt-4 pb-5">
      <header className="flex items-center justify-between gap-2">
        {previousMonth === null ? (
          <span className="size-11" />
        ) : (
          <Link
            href={hrefFor(previousMonth)}
            aria-label={previousLabel}
            className="grid size-11 place-items-center rounded-full border border-brand-stone/25 text-crm-body font-bold text-brand-obsidian"
          >
            ‹
          </Link>
        )}

        <h3 className="font-display text-title font-bold text-brand-obsidian">{monthLabel}</h3>

        {/* Hidden rather than disabled when the next month has not happened: a dead arrow
            invites tapping. The slot is kept so the heading does not jump. */}
        {nextMonth === null ? (
          <span className="size-11" />
        ) : (
          <Link
            href={hrefFor(nextMonth)}
            aria-label={nextLabel}
            className="grid size-11 place-items-center rounded-full border border-brand-stone/25 text-crm-body font-bold text-brand-obsidian"
          >
            ›
          </Link>
        )}
      </header>

      <div className="mt-3 grid grid-cols-7 gap-1" role="presentation">
        {weekdayLabels.map((label, index) => (
          <span key={index} aria-hidden className="pb-1 text-center text-small font-semibold text-brand-stone">
            {label}
          </span>
        ))}

        {weeks.flat().map((cell) => {
          const isSelected = cell.date === selected;
          // Four bands rather than a continuous ramp: a shade a person can name.
          const share = cell.visits / busiest;
          const tone = !cell.inMonth
            ? ''
            : cell.isFuture
              // Was `text-brand-stone/40`, which is 1.65:1 — a date nobody with ordinary
              // eyesight reads in daylight on a phone at the counter. There is no "faint
              // but legible" grey on white: anything that clears 4.5:1 is about as dark
              // as `brand-stone` already is, so a future day is simply secondary text,
              // and it is told apart from a past one by having no shading behind it.
              ? 'text-brand-stone'
              : cell.visits === 0
                ? 'bg-brand-stone/8 text-brand-stone'
                : share > 0.75
                  ? 'bg-brand-accent text-white'
                  : share > 0.45
                    ? 'bg-brand-accent/55 text-brand-obsidian'
                    : 'bg-brand-accent/25 text-brand-obsidian';

          if (cell.isFuture || !cell.inMonth) {
            return (
              <span
                key={cell.date}
                aria-hidden
                className={cn('grid min-h-14 place-items-center rounded-lg text-crm-body', tone)}
              >
                {/* A day belonging to the month either side is padding, and printing its
                    number in grey only invites somebody to tap it. The cell keeps its
                    space so the grid stays square. */}
                {cell.inMonth ? Number(cell.date.slice(8, 10)) : null}
              </span>
            );
          }

          return (
            <Link
              key={cell.date}
              href={hrefFor(cell.date)}
              aria-current={isSelected ? 'date' : undefined}
              // The number alone tells a screen reader nothing; the count is the content.
              aria-label={`${cell.date} — ${visitsLabel(cell.visits)}`}
              className={cn(
                'grid min-h-14 place-items-center rounded-lg text-crm-body font-semibold transition-colors',
                tone,
                cell.isToday && !isSelected && 'ring-2 ring-brand-obsidian/30 ring-inset',
                isSelected && 'ring-2 ring-brand-obsidian ring-inset',
              )}
            >
              <span className="flex flex-col items-center leading-none">
                <span>{Number(cell.date.slice(8, 10))}</span>
                {/* No `opacity-80` here: it cost this count about a point of contrast on
                    the paler shades, which is the last thing on the calendar that failed
                    (A11Y-001). Being smaller and lighter already marks it as secondary. */}
                {cell.visits > 0 ? <span className="mt-0.5 text-[0.6875rem] font-normal">{cell.visits}</span> : null}
              </span>
            </Link>
          );
        })}
      </div>

      {selected === today ? null : (
        <Link href={hrefFor(today)} className="mt-3 inline-flex min-h-11 items-center text-crm-body font-semibold text-brand-link underline underline-offset-4">
          {todayLabel}
        </Link>
      )}
    </section>
  );
}
