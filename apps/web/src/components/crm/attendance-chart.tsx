import { useTranslations } from 'next-intl';
import type { AttendanceTrend } from '@mfp/core';
import { cn } from '@/lib/cn';

/**
 * The last week of arrivals (ADR-095).
 *
 * Seven bars and two numbers. The owner is not reading values off it — they are reading
 * the shape, so there are no gridlines, no axis and no number on every bar: those would
 * add ink without adding an answer. Today's bar is drawn in the accent colour because it
 * is still filling up and must not be compared with a finished day by mistake.
 *
 * It is a table underneath, which is what makes it readable at all with a screen reader:
 * the bars are decoration over real figures, not a picture of figures kept somewhere else.
 */
export function AttendanceChart({ trend, dayNames }: { trend: AttendanceTrend; dayNames: readonly string[] }) {
  const t = useTranslations('crm.home');
  const quiet = trend.busiest === 0;

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-display text-[2rem] leading-none font-bold text-brand-obsidian tabular">{trend.total}</p>
          <p className="mt-1 text-small text-brand-stone">{t('weekArrivals')}</p>
        </div>
        {quiet ? null : (
          <p className="text-right text-small text-brand-stone">
            {t('weekAverage', { count: trend.averageBeforeToday })}
          </p>
        )}
      </div>

      {/* The figures themselves; the bars above are drawn from these. */}
      <table className="sr-only">
        <caption>{t('weekArrivals')}</caption>
        <tbody>
          {trend.bars.map((bar, index) => (
            <tr key={bar.date}>
              <th scope="row">{dayNames[index]}</th>
              <td>{bar.count}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul aria-hidden className="mt-4 flex h-24 items-end gap-1.5">
        {trend.bars.map((bar, index) => (
          <li key={bar.date} className="flex h-full flex-1 flex-col justify-end gap-1.5">
            <span className="text-center text-[0.65rem] leading-none font-semibold text-brand-stone tabular">{bar.count === 0 ? '' : bar.count}</span>
            <span
              className={cn(
                'block w-full rounded-t-[3px] transition-[height]',
                bar.isToday ? 'bg-brand-accent' : 'bg-brand-obsidian/75',
              )}
              // A day with nobody in it still needs a mark, or the week looks shorter than it is.
              style={{ height: `${Math.max(bar.height, bar.count === 0 ? 2 : 6)}%` }}
            />
            <span className={cn('text-center text-[0.65rem] leading-none', bar.isToday ? 'font-bold text-brand-accent' : 'text-brand-stone')}>
              {dayNames[index]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
