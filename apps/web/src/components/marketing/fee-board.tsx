'use client';

import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

/**
 * Fee board with the men / women toggle (PRD LP-09, wireframe §7).
 *
 * Receives finished rows: per-month, savings and best value are computed by
 * packages/core on the server, so the client only chooses which set to draw.
 * A real table from `md` up, stacked rows on phones. Exactly one gold "Best value"
 * marker per set (DESIGN-BLUEPRINT §3), and only that row gets the red button —
 * four red buttons would drown the one that matters.
 */

export interface FeeRow {
  readonly code: string;
  readonly months: number;
  readonly price: string;
  readonly perMonth: string;
  /** `null` when there is no saving to advertise (BR-2.4). */
  readonly saving: string | null;
  readonly bestValue: boolean;
}

export type FeeAudience = 'men' | 'women';

const AUDIENCES: readonly FeeAudience[] = ['men', 'women'];

export function FeeBoard({ men, women }: { men: readonly FeeRow[]; women: readonly FeeRow[] }) {
  const t = useTranslations('plans');
  const [audience, setAudience] = useState<FeeAudience>('men');
  const rows = audience === 'men' ? men : women;

  const planName = (months: number) => (months === 1 ? t('monthly') : t('months', { count: months }));

  const chooseLink = (row: FeeRow, emphasis: boolean, full: boolean) => (
    <Link
      href={{ pathname: '/join', query: { plan: row.code } }}
      aria-label={t('chooseLabel', { plan: planName(row.months), price: row.price })}
      data-track="plan_selected"
      data-track-plan={row.code}
      className={buttonVariants({ variant: emphasis ? 'primary' : 'outlineDark', full })}
    >
      {t('choose')}
    </Link>
  );

  const bestValueBadge = (
    <span className="inline-block rounded-button bg-brand-medal-gold px-2 py-0.5 text-small font-semibold text-brand-plate-navy">
      {t('bestValue')}
    </span>
  );

  return (
    <div className="mt-8">
      <ToggleGroup.Root
        type="single"
        value={audience}
        // Radix lets a single toggle be switched off; a fee board always shows one set.
        onValueChange={(value) => {
          if (value === 'men' || value === 'women') setAudience(value);
        }}
        aria-label={t('toggleLabel')}
        className="inline-flex rounded-button border-2 border-brand-plate-navy p-1"
      >
        {AUDIENCES.map((value) => (
          <ToggleGroup.Item
            key={value}
            value={value}
            className={cn(
              'min-h-11 min-w-28 rounded-[4px] px-5 text-body font-semibold text-brand-plate-navy',
              'transition-colors duration-[var(--duration-fast)]',
              'data-[state=on]:bg-brand-plate-navy data-[state=on]:text-brand-chalk',
            )}
          >
            {t(value)}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>

      <table className="mt-8 hidden w-full border-collapse md:table">
        <caption className="sr-only" aria-live="polite">
          {`${t('h2')}: ${t(audience)}`}
        </caption>
        <thead>
          <tr className="border-b-2 border-brand-plate-navy text-left text-small text-brand-rubber-grey">
            <th scope="col" className="py-3 pl-4 font-semibold">
              {t('colPlan')}
            </th>
            <th scope="col" className="py-3 font-semibold">
              {t('colPrice')}
            </th>
            <th scope="col" className="py-3 font-semibold">
              {t('colPerMonth')}
            </th>
            <th scope="col" className="py-3 font-semibold">
              {t('colSave')}
            </th>
            <th scope="col" className="py-3 pr-4">
              <span className="sr-only">{t('choose')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.code}
              className={cn(
                'border-b border-brand-rubber-grey/20',
                // A gold rule on the leading edge marks the one recommended plan.
                row.bestValue && 'bg-brand-chalk shadow-[inset_4px_0_0_var(--color-brand-medal-gold)]',
              )}
            >
              <th scope="row" className="py-5 pl-5 text-left align-middle">
                <span className="block text-title font-semibold text-brand-plate-navy">{planName(row.months)}</span>
                {row.bestValue ? <span className="mt-1 block">{bestValueBadge}</span> : null}
              </th>
              <td className="tabular py-5 align-middle font-display text-display-m leading-none font-bold text-brand-signboard-red-text">
                {row.price}
              </td>
              <td className="tabular py-5 align-middle text-body">{row.perMonth}</td>
              <td className="tabular py-5 align-middle text-body font-semibold text-brand-ink">
                {row.saving ?? (
                  <span aria-label={t('noSavingLabel')} className="font-normal text-brand-rubber-grey">
                    —
                  </span>
                )}
              </td>
              <td className="py-5 pr-4 text-right align-middle">{chooseLink(row, row.bestValue, false)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="mt-6 grid gap-3 md:hidden">
        {rows.map((row) => (
          <li
            key={row.code}
            className={cn(
              'rounded-panel bg-brand-chalk p-5',
              row.bestValue ? 'border-2 border-brand-medal-gold' : 'border border-brand-rubber-grey/20',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-title font-semibold text-brand-plate-navy">{planName(row.months)}</p>
                {row.bestValue ? <p className="mt-1">{bestValueBadge}</p> : null}
              </div>
              <p className="tabular font-display text-display-m leading-none font-bold text-brand-signboard-red-text">
                {row.price}
              </p>
            </div>
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-small">
              <div className="flex gap-1">
                <dt className="text-brand-rubber-grey">{t('colPerMonth')}</dt>
                <dd className="tabular font-semibold">{row.perMonth}</dd>
              </div>
              {row.saving === null ? null : (
                <div className="flex gap-1">
                  <dt className="text-brand-rubber-grey">{t('colSave')}</dt>
                  <dd className="tabular font-semibold text-brand-ink">{row.saving}</dd>
                </div>
              )}
            </dl>
            <div className="mt-4">{chooseLink(row, row.bestValue, true)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
