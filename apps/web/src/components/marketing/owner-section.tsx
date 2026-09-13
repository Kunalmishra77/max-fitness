import { getLocale, getTranslations } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { PhotoPlaceholder } from './brand';

/**
 * Meet the owner — the page's one bold moment (DESIGN-BLUEPRINT §6.3, PRD LP-10).
 *
 * This was the "National Champion" plaque. No source confirms a championship, so the
 * section now says only what the Google Business Profile and members' reviews support:
 * Ajay Kuliyal runs the gym, coaches members himself with a team of trainers, and the
 * gym has served Nyay Khand since 2000 (ADR-031). The quote is a member's exact words,
 * attributed. Same layout and gold treatment as the plaque.
 */

const FACTS = ['since', 'rating', 'team', 'today'] as const;

export async function OwnerSection({
  rating,
  reviewCount,
  quoteAuthor,
  whatsappHref,
}: {
  rating: string;
  reviewCount: number;
  quoteAuthor: string;
  whatsappHref: string;
}) {
  const t = await getTranslations('owner');
  const tg = await getTranslations('gallery');
  const locale = await getLocale();
  const values = { rating, count: reviewCount };

  return (
    <section
      id="owner"
      aria-labelledby="owner-heading"
      className="deferred-render scroll-mt-20 bg-brand-plate-navy text-brand-chalk"
    >
      <div className="mx-auto grid max-w-[var(--size-content-max)] gap-10 px-5 py-16 md:grid-cols-12 md:gap-6 md:px-6 md:py-24">
        <div className="md:col-span-5">
          <PhotoPlaceholder tone="onNavy" label={t('portraitAlt')} caption={tg('placeholder')} aspect="aspect-[4/5]" />
        </div>

        <div className="md:col-span-6 md:col-start-7 md:self-center">
          <p className="text-title font-semibold">{t('name')}</p>
          <p className="mt-1 text-body text-brand-chalk/80">{t('role')}</p>
          <h2
            id="owner-heading"
            className="mt-4 font-display text-display-xl leading-display font-bold text-brand-medal-gold"
          >
            {t('title')}
          </h2>

          <p className="mt-6 max-w-[60ch] text-body-l leading-body">{t('lead')}</p>

          <figure className="mt-8 border-l-2 border-brand-medal-gold pl-5">
            {/* A member's words, quoted as written — in English on the Hindi page too. */}
            <blockquote
              lang={locale === 'hi' ? 'en' : undefined}
              className="font-display text-display-m leading-tight font-semibold"
            >
              “{t('quote')}”
            </blockquote>
            <figcaption className="mt-3 text-small text-brand-chalk/75">{t('quoteSource', { author: quoteAuthor })}</figcaption>
          </figure>

          <h3 className="mt-10 text-title font-semibold">{t('factsHeading')}</h3>
          <ul className="mt-4 grid gap-3">
            {FACTS.map((fact) => (
              <li key={fact} className="grid grid-cols-[6.5rem_1fr] items-baseline gap-4 border-b border-brand-chalk/10 pb-3">
                <span className="font-display text-title leading-none font-bold text-brand-medal-gold">
                  {t(`facts.${fact}.value`, values)}
                </span>
                <span className="text-body">{t(`facts.${fact}.text`, values)}</span>
              </li>
            ))}
          </ul>

          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            data-track="whatsapp_click"
            data-track-source="owner"
            className={cn(buttonVariants({ variant: 'primary', size: 'hero' }), 'mt-10')}
          >
            {t('cta')}
          </a>
        </div>
      </div>
    </section>
  );
}
