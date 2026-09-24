import { getTranslations } from 'next-intl/server';
import type { TrustNumbers } from '@mfp/shared';
import { Section } from './section';

/**
 * Trust strip (PRD LP-05, wireframe §3).
 *
 * Plain, verifiable numbers — ratings, "since 2000", the weekly hours — instead of a
 * stats row with gradients (DESIGN-BLUEPRINT §11). Numbers are set in Khand; every
 * figure comes from settings, so the owner updates it without a deploy. The hours line
 * is the weekly schedule rather than "open now", so the strip can be served from a
 * static cache (ADR-032).
 */
export async function TrustStrip({ trust, hoursLine }: { trust: TrustNumbers; hoursLine: string | null }) {
  const t = await getTranslations('trust');
  const num = (chunks: React.ReactNode) => <span className="font-display text-display-m leading-none font-bold text-brand-accent-glow">{chunks}</span>;

  const items: React.ReactNode[] = [
    t.rich('google', { rating: trust.googleRating.toFixed(1), count: trust.googleReviews, num }),
    t.rich('justdial', { rating: trust.justdialRating.toFixed(1), count: trust.justdialReviews, num }),
    t.rich('since', { year: trust.establishedYear, num }),
    t('beginners'),
    ...(hoursLine === null ? [] : [hoursLine]),
  ];

  return (
    <Section tone="navy" density="strip" className="border-t border-brand-accent/60 bg-brand-graphite">
      <h2 className="sr-only">{t('label')}</h2>
      {/* Wraps at every width. It used to stop wrapping from `md`, where five
          nowrap chips do not fit 768px and pushed the whole page sideways. */}
      <ul className="flex flex-wrap justify-center gap-2 md:gap-x-6 md:gap-y-3">
        {items.map((item, i) => (
          <li
            key={i}
            className="flex min-h-11 max-w-full shrink items-center gap-2 rounded-button border border-brand-paper/15 px-3 text-small font-medium tracking-wide text-brand-mist"
          >
            {item}
          </li>
        ))}
      </ul>
    </Section>
  );
}
