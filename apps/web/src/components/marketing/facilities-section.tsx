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
 * Not a row of identical cards: an asymmetric grid that mirrors the real floor —
 * two wide zones on top, a narrow boxing corner beside a wide functional floor below.
 * "Also here" lists only confirmed facilities in production (LP-07 acceptance). A zone
 * with no photo of its own yet keeps the placeholder rather than borrowing one (ADR-057).
 */

const LAYOUT: ReadonlyArray<{ zone: FacilityZone; span: string; aspect: string }> = [
  { zone: 'strength', span: 'md:col-span-7', aspect: 'aspect-[4/3]' },
  { zone: 'cardio', span: 'md:col-span-5', aspect: 'aspect-[4/3] md:aspect-auto md:h-full md:min-h-64' },
  { zone: 'boxing', span: 'md:col-span-4', aspect: 'aspect-[4/3] md:aspect-square' },
  { zone: 'functional', span: 'md:col-span-8', aspect: 'aspect-[16/9]' },
];

export async function FacilitiesSection({ showUnconfirmed }: { showUnconfirmed: boolean }) {
  const t = await getTranslations('facilities');
  const tc = await getTranslations('common');
  const tg = await getTranslations('gallery');
  const tp = await getTranslations('photos');

  const extras = FACILITY_EXTRAS.filter((extra) => extra.confirmed || showUnconfirmed);

  return (
    <Section id="facilities" tone="navy" labelledBy="facilities-heading">
      <SectionHeading id="facilities-heading">{t('h2')}</SectionHeading>

      <div className="mt-10 grid gap-x-6 gap-y-10 md:grid-cols-12">
        {LAYOUT.map(({ zone, span, aspect }) => {
          const photoId = FACILITY_PHOTOS[zone];
          return (
          <figure key={zone} className={cn('flex flex-col', span)}>
            {photoId === null ? (
              <PhotoPlaceholder tone="onNavy" label={t(`zones.${zone}.name`)} caption={tg('placeholder')} aspect={aspect} />
            ) : (
              <SitePhoto
                photo={SITE_PHOTOS[photoId]}
                alt={tp(photoId)}
                sizes="(min-width: 768px) 58vw, 100vw"
                aspect={aspect}
                className="rounded-photo"
              />
            )}
            <figcaption className="mt-4">
              <h3 className="text-title font-semibold">{t(`zones.${zone}.name`)}</h3>
              <p className="mt-1 max-w-[52ch] text-body leading-body text-brand-chalk/80">{t(`zones.${zone}.body`)}</p>
            </figcaption>
          </figure>
          );
        })}
      </div>

      {extras.length > 0 ? (
        <div className="mt-12 border-t border-brand-chalk/15 pt-6">
          <h3 className="text-title font-semibold">{t('alsoHere')}</h3>
          <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
            {extras.map((extra) => (
              <li key={extra.key} className="flex items-center gap-2 text-body">
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
