import { needsDeskPriceConfirmation, planCards } from '@mfp/core';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import type { PriceLists } from '@/components/join/join-flow';
import { MarketingShell } from '@/components/marketing/marketing-shell';
import { getPathname } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getSiteContext, type SiteContext } from './site-context';

/**
 * Shared server pieces of the `/join` pages (signup-and-payment-flow.md §1).
 *
 * Every step renders per request (`force-dynamic`, ADR-032) inside the marketing shell,
 * with the `signup` messages supplied only to the sign-up subtree — the landing page's
 * client payload does not carry the sign-up catalogue.
 */

export async function joinMetadata(params: Promise<{ locale: string }>): Promise<Metadata> {
  const locale = (await params).locale as Locale;
  const t = await getTranslations({ locale, namespace: 'signup' });
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

export async function joinContext(params: Promise<{ locale: string }>): Promise<SiteContext> {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  return getSiteContext(locale);
}

/** Price lists for each gender, computed by the domain (BR-2.5) from the cached plan read. */
export function priceLists(ctx: SiteContext): PriceLists {
  const { plans, settings } = ctx.data;
  const list = (gender: 'MALE' | 'FEMALE' | 'OTHER') => ({
    cards: planCards(plans, gender, settings.pricing),
    deskConfirmsPrice: needsDeskPriceConfirmation(gender, settings.pricing.otherGenderPricing),
  });
  return { MALE: list('MALE'), FEMALE: list('FEMALE'), OTHER: list('OTHER') };
}

export function legalHref(locale: Locale, slug: 'terms' | 'privacy'): string {
  return getPathname({ href: `/legal/${slug}`, locale });
}

export async function JoinPage({ ctx, children }: { ctx: SiteContext; children: ReactNode }) {
  const messages = await getMessages({ locale: ctx.locale });
  return (
    <MarketingShell ctx={ctx} onHome={false}>
      <NextIntlClientProvider messages={{ signup: messages['signup'] as Record<string, unknown> }}>{children}</NextIntlClientProvider>
    </MarketingShell>
  );
}

/** The sign-up catalogue for a modal, which renders outside the page's own provider. */
export async function JoinModalMessages({ ctx, children }: { ctx: SiteContext; children: ReactNode }) {
  const messages = await getMessages({ locale: ctx.locale });
  return <NextIntlClientProvider messages={{ signup: messages['signup'] as Record<string, unknown> }}>{children}</NextIntlClientProvider>;
}

export async function PlansUnavailable({ ctx }: { ctx: SiteContext }) {
  const t = await getTranslations({ locale: ctx.locale, namespace: 'signup.plan' });
  return (
    <p role="alert" className="rounded-panel bg-tint-fee-due-soon-bg p-5 text-body leading-body">
      {t('unavailable')}{' '}
      <a href={ctx.contact.telHref} className="font-semibold text-brand-wall-blue underline underline-offset-2">
        {ctx.contact.phoneDisplay}
      </a>
    </p>
  );
}
