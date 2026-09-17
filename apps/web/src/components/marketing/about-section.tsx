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
  const num = (chunks: React.ReactNode) => <span className="font-display text-title leading-none font-bold">{chunks}</span>;

  const facts: React.ReactNode[] = [
    t.rich('years', { count: years, num }),
    t('beginners'),
    ...(hoursLine === null ? [] : [hoursLine]),
  ];

  return (
    <Section id="about" tone="chalk" labelledBy="about-heading">
      <div className="grid gap-10 md:grid-cols-12 md:gap-6">
        <div className="relative md:col-span-6">
          <SitePhoto
            photo={SITE_PHOTOS[ABOUT_PHOTOS.main]}
            alt={t('photoMain')}
            sizes="(min-width: 768px) 50vw, 100vw"
            aspect="aspect-[4/3]"
            className="rounded-photo"
          />
          <SitePhoto
            photo={SITE_PHOTOS[ABOUT_PHOTOS.inset]}
            alt={t('photoInset')}
            sizes="20vw"
            aspect="aspect-square"
            className="absolute -right-3 -bottom-8 hidden w-2/5 rounded-photo border-4 border-brand-chalk md:block"
          />
        </div>

        <div className="md:col-span-5 md:col-start-8 md:self-center">
          <SectionHeading id="about-heading" className="text-brand-plate-navy">
            {t('h2')}
          </SectionHeading>
          <p className="mt-6 max-w-[65ch] text-body-l leading-body">{t('p1')}</p>
          <p className="mt-4 max-w-[65ch] text-body leading-body text-brand-ink/80">{t('p2')}</p>

          <h3 className="sr-only">{t('factsLabel')}</h3>
          <ul className="mt-8 grid gap-3 border-t border-brand-rubber-grey/20 pt-6">
            {facts.map((fact, i) => (
              <li key={i} className="flex items-baseline gap-2 text-body font-medium">
                {fact}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
