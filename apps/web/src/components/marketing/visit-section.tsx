import { getTranslations } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/button';
import { HoursTable, type HoursTableRow } from './hours-table';
import { ChatIcon, MapPinIcon, PhoneIcon } from './icons';
import { MapEmbed } from './map-embed';
import { Section, SectionHeading } from './section';

/**
 * Timings, visit and contact (PRD LP-19, wireframe §12 and §15).
 *
 * The hours table (today's row highlighted in the browser), then "Finding us" with the
 * address, three actions and the click-to-load map. Wireframe §15's separate contact
 * block repeated the same address and buttons, so it is folded in here and this section
 * carries the `#contact` anchor.
 */

export type { HoursTableRow };

export async function VisitSection({
  rows,
  address,
  phoneDisplay,
  telHref,
  whatsappHref,
  directionsHref,
  mapSrc,
}: {
  rows: readonly HoursTableRow[];
  address: string;
  phoneDisplay: string;
  telHref: string;
  whatsappHref: string;
  directionsHref: string;
  mapSrc: string;
}) {
  const t = await getTranslations('visit');

  return (
    <Section id="contact" tone="chalk" labelledBy="visit-heading">
      <SectionHeading id="visit-heading" className="text-brand-plate-navy">
        {t('h2')}
      </SectionHeading>

      <div className="mt-10 grid gap-12 md:grid-cols-2">
        <div>
          <h3 className="text-title font-semibold text-brand-plate-navy">{t('hoursHeading')}</h3>
          {rows.length === 0 ? (
            <p className="mt-4 text-body leading-body">{t('hoursUnknown')}</p>
          ) : (
            <HoursTable rows={rows} todayLabel={t('today')} closedLabel={t('closed')} />
          )}

          <h3 className="mt-10 text-title font-semibold text-brand-plate-navy">{t('findingUs')}</h3>
          <p className="mt-4 flex gap-3 text-body-l leading-body">
            <MapPinIcon className="mt-1.5 shrink-0 text-brand-signboard-red-text" />
            {/* The address line already names the landmark (opposite Sai Mandir). */}
            <span>{address}</span>
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <a href={telHref} data-track="call_click" data-track-source="visit" className={buttonVariants({ variant: 'primary' })}>
              <PhoneIcon />
              {t('call', { phone: phoneDisplay })}
            </a>
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              data-track="whatsapp_click"
              data-track-source="visit"
              className={buttonVariants({ variant: 'outlineDark' })}
            >
              <ChatIcon />
              {t('whatsapp')}
            </a>
            <a
              href={directionsHref}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'outlineDark' })}
            >
              <MapPinIcon />
              {t('directions')}
            </a>
          </div>
        </div>

        <div className="md:pt-11">
          <MapEmbed src={mapSrc} />
        </div>
      </div>
    </Section>
  );
}
