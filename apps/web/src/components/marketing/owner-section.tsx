import { getLocale, getTranslations } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { Eyebrow } from './section';

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
  const locale = await getLocale();
  const values = { rating, count: reviewCount };

  return (
    <section
      id="owner"
      aria-labelledby="owner-heading"
      className="deferred-render scroll-mt-20 bg-brand-obsidian text-brand-paper"
    >
      <div className="mx-auto grid max-w-[var(--size-content-max)] gap-10 px-5 py-16 lg:grid-cols-12 lg:gap-6 md:px-6 md:py-24">
        <div className="lg:col-span-5">
          {/* Until the owner's portrait is shot: the gym's mark on a lit plate, named for what it will hold. */}
          <div
            role="img"
            aria-label={t('portraitAlt')}
            className="relative flex aspect-[4/5] w-full items-center justify-center overflow-hidden rounded-photo border border-brand-paper/10 bg-[radial-gradient(circle_at_50%_40%,rgb(217_15_31/0.35),transparent_60%),linear-gradient(160deg,#1c1c21,#0a0a0b)]"
          >
            <span aria-hidden className="text-outline absolute -bottom-6 left-1/2 -translate-x-1/2 font-display text-[9rem] leading-none font-bold whitespace-nowrap text-brand-paper/15 uppercase">
              {t('name')}
            </span>
            <img src="/brand/logo-384.webp" alt="" width={396} height={384} decoding="async" loading="lazy" className="relative w-3/5 drop-shadow-[0_0_40px_rgb(237_16_33/0.35)]" />
          </div>
        </div>

        <div className="lg:col-span-6 lg:col-start-7 lg:self-center">
          <Eyebrow onDark>{t('eyebrow')}</Eyebrow>
          <p className="mt-6 font-display text-title font-bold tracking-[0.06em] uppercase">{t('name')}</p>
          <p className="mt-1 text-body text-brand-mist">{t('role')}</p>
          <h2
            id="owner-heading"
            className="mt-4 font-display text-display-xl leading-display font-bold tracking-[0.01em] text-brand-white uppercase"
          >
            {t('title')}
          </h2>

          <p className="mt-6 max-w-[60ch] text-body-l leading-body">{t('lead')}</p>

          <figure className="mt-8 border-l-4 border-brand-accent pl-5">
            {/* A member's words, quoted as written — in English on the Hindi page too. */}
            <blockquote
              lang={locale === 'hi' ? 'en' : undefined}
              className="font-display text-display-m leading-tight font-semibold"
            >
              “{t('quote')}”
            </blockquote>
            <figcaption className="mt-3 text-small text-brand-paper/75">{t('quoteSource', { author: quoteAuthor })}</figcaption>
          </figure>

          <h3 className="mt-10 text-title font-semibold">{t('factsHeading')}</h3>
          <ul className="mt-4 grid gap-3">
            {FACTS.map((fact) => (
              <li key={fact} className="grid grid-cols-[6.5rem_1fr] items-baseline gap-4 border-b border-brand-paper/10 pb-3">
                <span className="font-display text-title leading-none font-bold text-brand-accent-glow">
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
