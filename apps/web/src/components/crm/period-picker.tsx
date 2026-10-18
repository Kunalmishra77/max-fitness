import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReportPeriod } from '@mfp/core';
import { pillClass } from './crm-chrome';

/**
 * The window a screen is reporting on (REP-001, REP-004).
 *
 * Written once because it has to mean the same thing everywhere. "This week" on the
 * reports and "this week" on the calls are the same week — `readReportPeriod` decides
 * that on the server — and a control that looked or behaved differently between the two
 * would make the owner doubt whether the figures line up. They do.
 *
 * **Links and a plain GET form, not state.** A period can then be bookmarked, sent to
 * somebody, and reloaded, and the whole screen still renders with JavaScript off — which
 * is the difference between a reception desk on a bad connection seeing yesterday's
 * numbers and seeing nothing.
 */
export async function PeriodPicker({
  basePath,
  period,
  from,
  to,
  extra = {},
  problem = null,
  maxDays = 0,
}: {
  /** The screen this picker belongs to, e.g. `/crm/calls`. */
  basePath: string;
  period: ReportPeriod;
  from?: string | undefined;
  to?: string | undefined;
  /** Query the screen needs kept across a change of period, e.g. a tab. */
  extra?: Readonly<Record<string, string>>;
  /** What `readReportPeriod` said about a custom range it would not take. */
  problem?: 'TOO_LONG' | 'FUTURE' | null;
  /** The ceiling a range may not exceed, for the refusal's wording. */
  maxDays?: number;
}) {
  const t = await getTranslations('crm');
  const query = (params: Record<string, string>) => {
    const search = new URLSearchParams({ ...extra, ...params });
    const text = search.toString();
    return text === '' ? basePath : `${basePath}?${text}`;
  };

  return (
    <section aria-label={t('reports.viewing', { month: t(`reports.periods.${period}` as never) })}>
      <div className="flex flex-wrap gap-2">
        {(['WEEK', 'MONTH', 'YEAR'] as const).map((key) => (
          <Link key={key} href={query({ period: key })} className={pillClass(period === key)}>
            {t(`reports.periods.${key}` as never)}
          </Link>
        ))}
        {/* Not a link: a custom range has no destination until two dates are chosen. */}
        <span className={pillClass(period === 'CUSTOM')}>{t('reports.periods.CUSTOM')}</span>
      </div>

      <form method="get" action={basePath} className="mt-3 flex flex-wrap items-end gap-3">
        {Object.entries(extra).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <input type="hidden" name="period" value="CUSTOM" />
        <label className="flex flex-col gap-1 text-small font-semibold text-brand-stone">
          {t('reports.periodFrom')}
          <input
            type="date"
            name="from"
            defaultValue={from ?? ''}
            className="min-h-14 rounded-input border-2 border-brand-stone/40 bg-white px-3 text-crm-body text-brand-ink"
          />
        </label>
        <label className="flex flex-col gap-1 text-small font-semibold text-brand-stone">
          {t('reports.periodTo')}
          <input
            type="date"
            name="to"
            defaultValue={to ?? ''}
            className="min-h-14 rounded-input border-2 border-brand-stone/40 bg-white px-3 text-crm-body text-brand-ink"
          />
        </label>
        <button type="submit" className="min-h-14 rounded-button bg-brand-obsidian px-6 text-crm-body font-bold text-white">
          {t('reports.periodApply')}
        </button>
      </form>

      {problem === null ? null : (
        <p role="alert" className="mt-3 rounded-panel bg-tint-fee-none-bg p-3 text-crm-body font-semibold text-brand-obsidian">
          {problem === 'TOO_LONG' ? t('reports.periodTooLong', { days: maxDays }) : t('reports.periodFuture')}
        </p>
      )}
    </section>
  );
}
