import { getTranslations } from 'next-intl/server';
import { ABOUT_PHOTOS, SITE_PHOTOS } from '@/content/site-photos';
import { Section, SectionHeading } from './section';
import { SitePhoto } from './site-photo';

/**
 * About (PRD LP-06, wireframe §4): a large floor photo with an inset trainer photo,
 * beside two short paragraphs and three plain facts. Both photos are the gym's own (ADR-057). The hours fact is the weekly
 * schedule, so the section is the same whenever the cached page is served (ADR-032).
 */
export async function AboutSection({ years, hoursLine }: { years: number; hoursLine: string | null }) {
  const t = await getTranslations('about');
  const num = (chunks: React.ReactNode) => (
    <span className="font-display text-display-m text-brand-accent-deep leading-none font-bold">
      {chunks}
    </span>
  );

  const facts: React.ReactNode[] = [
    t.rich('years', { count: years, num }),
    t('beginners'),
    ...(hoursLine === null ? [] : [hoursLine]),
  ];

  return (
    <Section id="about" tone="chalk" labelledBy="about-heading">
      <div className="grid gap-10 md:grid-cols-12 md:gap-6">
        <div className="relative md:col-span-6">
          <div className="relative">
            {/* A red frame offset behind the photo (ADR-061). */}
            <span
              aria-hidden
              className="rounded-photo border-brand-accent absolute -top-4 -left-4 hidden size-full border-2 md:block"
            />
            <div className="photo-zoom rounded-photo relative">
              <SitePhoto
                photo={SITE_PHOTOS[ABOUT_PHOTOS.main]}
                alt={t('photoMain')}
                sizes="(min-width: 768px) 50vw, 100vw"
                aspect="aspect-[4/3]"
                className="rounded-photo"
              />
            </div>
          </div>
          <p className="rounded-photo bg-brand-obsidian text-brand-white absolute -bottom-6 left-4 flex items-center gap-3 px-5 py-4 shadow-[var(--shadow-overlay)] md:-bottom-8 md:left-6">
            <span className="font-display text-display-l text-brand-accent-glow leading-none font-bold">
              {years}+
            </span>
            <span className="text-small max-w-[9rem] font-semibold tracking-[0.14em] uppercase">
              {t('yearsBadge')}
            </span>
          </p>
          <SitePhoto
            photo={SITE_PHOTOS[ABOUT_PHOTOS.inset]}
            alt={t('photoInset')}
            sizes="20vw"
            aspect="aspect-square"
            className="rounded-photo border-brand-paper absolute -right-3 -bottom-8 hidden w-2/5 border-4 shadow-[var(--shadow-overlay)] md:block"
          />
        </div>

        <div className="md:col-span-5 md:col-start-8 md:self-center">
          <SectionHeading id="about-heading" eyebrow={t('eyebrow')} className="text-brand-obsidian">
            {t('h2')}
          </SectionHeading>
          <p className="text-body-l leading-body mt-6 max-w-[65ch]">{t('p1')}</p>
          <p className="text-body leading-body text-brand-ink/80 mt-4 max-w-[65ch]">{t('p2')}</p>

          <h3 className="sr-only">{t('factsLabel')}</h3>
          <ul className="border-brand-stone/20 mt-8 grid gap-3 border-t pt-6">
            {facts.map((fact, i) => (
              <li key={i} className="text-body flex items-baseline gap-2 font-medium">
                {fact}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
