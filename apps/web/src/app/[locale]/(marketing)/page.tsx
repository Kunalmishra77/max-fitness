import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { yearsOperating } from '@mfp/core';
import { AboutSection } from '@/components/marketing/about-section';
import { FacilitiesSection } from '@/components/marketing/facilities-section';
import { FaqSection } from '@/components/marketing/faq-section';
import { FinalCta } from '@/components/marketing/final-cta';
import { Gallery } from '@/components/marketing/gallery';
import { Hero } from '@/components/marketing/hero';
import { MarketingShell } from '@/components/marketing/marketing-shell';
import { OwnerSection } from '@/components/marketing/owner-section';
import { PlansSection } from '@/components/marketing/plans-section';
import { PromoBanner } from '@/components/marketing/promo-banner';
import { StartSection } from '@/components/marketing/start-section';
import { TestimonialsSection } from '@/components/marketing/testimonials-section';
import { TrustStrip } from '@/components/marketing/trust-strip';
import { VisitSection } from '@/components/marketing/visit-section';
import { OWNER_STORY } from '@/content/landing-content';
import type { Locale } from '@/i18n/routing';
import { jsonLd } from '@/lib/json-ld';
import { alternatesFor, gymJsonLd } from '@/lib/seo';
import { googleReviewsHref } from '@/lib/site';
import { getSiteContext } from '@/lib/site-context';

/**
 * The public landing page (PRD §5.1, LP-01…LP-22), sections in wireframe order.
 *
 * Served from the static cache and regenerated at most every 5 minutes, or at once when
 * the CRM revalidates the `plans`/`settings` tags (ADR-022, ADR-032). Nothing on the
 * page depends on the time of day except today's hours row, which the browser marks.
 */

export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = (await params).locale as Locale;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return {
    title: { absolute: t('title') },
    description: t('description'),
    alternates: alternatesFor('/', locale),
  };
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);

  const ctx = await getSiteContext(locale);
  const { data, contact } = ctx;

  return (
    <MarketingShell ctx={ctx} onHome>
      <Hero
        womenMonthly={ctx.monthly.women}
        rating={ctx.rating.google}
        reviewCount={ctx.rating.googleReviews}
        whatsappHref={contact.whatsappHref}
      />
      <TrustStrip trust={data.settings.trust} hoursLine={ctx.hours.line} />
      <AboutSection years={yearsOperating(data.settings.trust.establishedYear, ctx.today)} hoursLine={ctx.hours.line} />
      <FacilitiesSection showUnconfirmed={ctx.showUnconfirmed} />
      <StartSection phoneDisplay={contact.phoneDisplay} />
      <PlansSection
        plans={data.plans}
        pricing={data.settings.pricing}
        telHref={contact.telHref}
        phoneDisplay={contact.phoneDisplay}
        whatsappHref={contact.whatsappHref}
      />
      <PromoBanner text={ctx.promo.banner} whatsappHref={ctx.promo.whatsappHref} />
      <OwnerSection
        rating={ctx.rating.google}
        reviewCount={ctx.rating.googleReviews}
        quoteAuthor={OWNER_STORY.quoteAuthor}
        whatsappHref={contact.whatsappHref}
      />
      <TestimonialsSection reviews={ctx.reviews} googleReviewsUrl={googleReviewsHref()} />
      <Gallery />
      <VisitSection
        rows={ctx.hours.rows}
        address={contact.address}
        phoneDisplay={contact.phoneDisplay}
        telHref={contact.telHref}
        whatsappHref={contact.whatsappHref}
        directionsHref={contact.directionsHref}
        mapSrc={contact.mapSrc}
      />
      <FaqSection
        showUnconfirmed={ctx.showUnconfirmed}
        values={{
          hours: ctx.hours.summary,
          phoneDisplay: contact.phoneDisplay,
          menMonthly: ctx.monthly.men,
          womenMonthly: ctx.monthly.women,
          minAge: data.settings.privacy.minAge,
        }}
      />
      <FinalCta whatsappHref={contact.whatsappHref} />
      <script
        type="application/ld+json"
        // Safe: jsonLd() escapes `<`, so no value can close the script tag.
        dangerouslySetInnerHTML={{ __html: jsonLd(gymJsonLd(ctx)) }}
      />
    </MarketingShell>
  );
}
