import { getTranslations } from 'next-intl/server';
import { FACILITY_EXTRAS, type FacilityZone } from '@/content/landing-content';
import { FACILITY_PHOTOS, SITE_PHOTOS } from '@/content/site-photos';
import { cn } from '@/lib/cn';
import { ContentFlag, PhotoPlaceholder } from './brand';
import { Section, SectionHeading } from './section';
import { SitePhoto } from './site-photo';

/**
 * Facilities by zone (PRD LP-07, wireframe §5).
 *
 * Not a row of identical cards: an asymmetric grid that mirrors the real floor — two
 * zones side by side on top, the functional floor wide underneath. "Also here" lists only
 * confirmed facilities in production (LP-07 acceptance). A zone with no photo of its own
 * yet keeps the placeholder rather than borrowing one (ADR-057).
 */

const LAYOUT: ReadonlyArray<{ zone: FacilityZone; span: string; aspect: string }> = [
  { zone: 'strength', span: 'lg:col-span-7', aspect: 'aspect-[4/3]' },
  { zone: 'cardio', span: 'lg:col-span-5', aspect: 'aspect-[4/3] lg:aspect-auto lg:h-full lg:min-h-64' },
  // Full width, so losing the fourth zone leaves no hole in the row (2026-09-25).
  { zone: 'functional', span: 'lg:col-span-12', aspect: 'aspect-[16/9] lg:aspect-[21/9]' },
];

export async function FacilitiesSection({ showUnconfirmed }: { showUnconfirmed: boolean }) {
  const t = await getTranslations('facilities');
  const tc = await getTranslations('common');
  const tg = await getTranslations('gallery');
  const tp = await getTranslations('photos');

  const extras = FACILITY_EXTRAS.filter((extra) => extra.confirmed || showUnconfirmed);

  return (
    <Section id="facilities" tone="navy" labelledBy="facilities-heading">
      <SectionHeading id="facilities-heading" eyebrow={t('eyebrow')} onDark>
        {t('h2')}
      </SectionHeading>

      <div className="mt-10 grid gap-x-6 gap-y-10 lg:grid-cols-12">
        {LAYOUT.map(({ zone, span, aspect }, index) => {
          const photoId = FACILITY_PHOTOS[zone];
          return (
          <figure key={zone} className={cn('group flex flex-col', span)}>
            {photoId === null ? (
              <PhotoPlaceholder tone="onNavy" label={t(`zones.${zone}.name`)} caption={tg('placeholder')} aspect={aspect} />
            ) : (
              <div className="photo-zoom relative rounded-photo">
                <SitePhoto
                  photo={SITE_PHOTOS[photoId]}
                  alt={tp(photoId)}
                  sizes="(min-width: 768px) 58vw, 100vw"
                  aspect={aspect}
                  className="rounded-photo"
                />
                {/* A red rule wipes along the bottom edge on hover. */}
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-1 origin-left scale-x-0 bg-brand-accent transition-transform duration-500 group-hover:scale-x-100"
                />
              </div>
            )}
            <figcaption className="mt-5 flex gap-4">
              <span aria-hidden className="font-display text-display-m leading-none font-bold text-brand-accent-glow tabular">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span>
                <h3 className="font-display text-title font-bold tracking-[0.04em] uppercase">{t(`zones.${zone}.name`)}</h3>
                <p className="mt-1 max-w-[52ch] text-body leading-body text-brand-mist">{t(`zones.${zone}.body`)}</p>
              </span>
            </figcaption>
          </figure>
          );
        })}
      </div>

      {/* Supplements are a real part of what the gym does and a real reason members come
          back to the counter, so they get a panel rather than a chip. Nothing here names
          a brand or a price: we do not know them, and inventing them would be a lie
          printed on the gym's own website (ADR-084). */}
      <section className="mt-12 rounded-panel border border-brand-paper/15 bg-brand-paper/5 p-6 md:p-8">
        <h3 className="font-display text-title font-bold tracking-[0.04em] uppercase">{t('supplements.title')}</h3>
        <p className="mt-3 max-w-[60ch] text-body leading-body text-brand-mist">{t('supplements.body')}</p>
        <ul className="mt-5 grid gap-3 md:grid-cols-3">
          {(['point1', 'point2', 'point3'] as const).map((key) => (
            <li key={key} className="flex gap-3 text-body leading-body">
              <span aria-hidden className="mt-2 size-2 shrink-0 rotate-45 bg-brand-accent-glow" />
              <span>{t(`supplements.${key}`)}</span>
            </li>
          ))}
        </ul>
      </section>

      {extras.length > 0 ? (
        <div className="mt-12 border-t border-brand-paper/15 pt-6">
          <h3 className="text-title font-semibold">{t('alsoHere')}</h3>
          <ul className="mt-4 flex flex-wrap gap-3">
            {extras.map((extra) => (
              <li
                key={extra.key}
                className="flex items-center gap-2 rounded-full border border-brand-paper/15 px-4 py-2 text-body transition-colors hover:border-brand-accent-glow"
              >
                {t(`extras.${extra.key}`)}
                {extra.confirmed ? null : <ContentFlag tone="onNavy">{tc('needsConfirmation')}</ContentFlag>}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}
