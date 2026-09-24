import { getTranslations } from 'next-intl/server';
import { formatINR } from '@mfp/shared';
import type { PriceLists } from '@/components/join/join-flow';

/**
 * Everything a stranger needs before they decide (client decision, ADR-075).
 *
 * Somebody who has just scanned a poster on a wall knows nothing about this gym.
 * Sending them straight into a form asks for their date of birth before it has told
 * them what a month costs. So `/qr/new` shows the gym first — prices for their own
 * gender, when it opens, what is in it, what other members say about it — and the
 * form comes after.
 *
 * Every figure comes from the gym's own settings, so the owner changes a price in Max
 * Register and this page changes with it.
 */
export async function GymAtAGlance({
  locale,
  prices,
  hoursLine,
  rating,
  reviews,
  admissionFeePaise,
}: {
  readonly locale: string;
  readonly prices: PriceLists;
  readonly hoursLine: string | null;
  readonly rating: number;
  readonly reviews: number;
  readonly admissionFeePaise: number;
}) {
  const t = await getTranslations({ locale, namespace: 'qrNew' });

  const columns = [
    { key: 'MALE' as const, cards: prices.MALE.cards },
    { key: 'FEMALE' as const, cards: prices.FEMALE.cards },
  ];

  return (
    <section className="grid gap-6 rounded-panel border border-brand-stone/20 bg-white p-5 md:p-6">
      <div>
        <h2 className="font-display text-title font-bold text-brand-obsidian">{t('title')}</h2>
        <p className="mt-1 text-body text-brand-stone">{t('ratingLine', { rating: rating.toFixed(1), reviews })}</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {columns.map((column) => (
          <div key={column.key}>
            <h3 className="text-body font-semibold text-brand-obsidian">{t(`for.${column.key}` as never)}</h3>
            <dl className="mt-2 grid gap-1">
              {column.cards.map((card) => (
                <div key={card.planId} className="flex items-baseline justify-between gap-3 border-b border-brand-stone/15 py-1.5">
                  <dt className="text-body text-brand-ink">{t('months', { count: card.durationMonths })}</dt>
                  <dd className="font-display text-title font-bold tabular text-brand-obsidian">{formatINR(card.pricePaise, { showPaise: false })}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>

      <dl className="grid gap-2 text-body">
        {hoursLine === null ? null : (
          <div className="flex flex-wrap gap-2">
            <dt className="font-semibold text-brand-obsidian">{t('hours')}</dt>
            <dd className="text-brand-stone">{hoursLine}</dd>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <dt className="font-semibold text-brand-obsidian">{t('admission')}</dt>
          <dd className="text-brand-stone">
            {admissionFeePaise === 0 ? t('admissionNone') : formatINR(admissionFeePaise, { showPaise: false })}
          </dd>
        </div>
        <div className="flex flex-wrap gap-2">
          <dt className="font-semibold text-brand-obsidian">{t('includes')}</dt>
          <dd className="text-brand-stone">{t('includesList')}</dd>
        </div>
      </dl>

      {/* Said before the form rather than after it, because "how do I pay" is the
          question somebody asks themselves while deciding whether to start. */}
      <p className="rounded-input bg-brand-paper p-4 text-body font-semibold text-brand-ink">{t('payAtReception')}</p>
    </section>
  );
}
