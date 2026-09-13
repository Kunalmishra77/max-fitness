import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MarketingShell } from '@/components/marketing/marketing-shell';
import { VisitSection } from '@/components/marketing/visit-section';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';
import { getSiteContext } from '@/lib/site-context';

/** Contact page (copy deck: NAP, hours, grievance contact). Reuses the visit section; statically cached (ADR-032). */

export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = (await params).locale as Locale;
  const t = await getTranslations({ locale, namespace: 'legal' });
  return { title: t('titles.contact'), alternates: alternatesFor('/contact', locale) };
}

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);

  const [ctx, t, tl] = await Promise.all([getSiteContext(locale), getTranslations('contactPage'), getTranslations('legal')]);
  const { contact } = ctx;

  return (
    <MarketingShell ctx={ctx} onHome={false}>
      <div className="bg-brand-chalk">
        <div className="mx-auto max-w-[var(--size-content-max)] px-5 pt-12 md:px-6 md:pt-16">
          <h1 className="font-display text-display-l leading-display font-bold text-brand-plate-navy">{tl('titles.contact')}</h1>
          <p className="mt-4 max-w-[60ch] text-body-l leading-body">{t('intro')}</p>
        </div>
      </div>
      <VisitSection
        rows={ctx.hours.rows}
        address={contact.address}
        phoneDisplay={contact.phoneDisplay}
        telHref={contact.telHref}
        whatsappHref={contact.whatsappHref}
        directionsHref={contact.directionsHref}
        mapSrc={contact.mapSrc}
      />
      <div className="bg-brand-white">
        <div className="mx-auto max-w-[var(--size-content-max)] px-5 py-12 md:px-6">
          <h2 className="font-display text-display-m leading-tight font-bold text-brand-plate-navy">{t('grievanceHeading')}</h2>
          <p className="mt-3 max-w-[65ch] text-body leading-body">{t('grievanceBody')}</p>
        </div>
      </div>
    </MarketingShell>
  );
}
