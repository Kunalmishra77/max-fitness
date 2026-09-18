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
      {/* Wraps on phones rather than scrolling sideways, so no fact hides off-screen. */}
      <ul className="flex flex-wrap gap-2 md:flex-nowrap md:justify-between md:gap-6">
        {items.map((item, i) => (
          <li
            key={i}
            className="flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-button border border-brand-paper/15 px-3 text-small font-medium tracking-wide whitespace-nowrap text-brand-mist md:rounded-none md:border-0 md:border-l md:border-brand-paper/10 md:pl-6 md:first:border-l-0 md:first:pl-0"
          >
            {item}
          </li>
        ))}
      </ul>
    </Section>
  );
}
