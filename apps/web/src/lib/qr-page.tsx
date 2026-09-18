import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { MarketingShell } from '@/components/marketing/marketing-shell';
import type { Locale } from '@/i18n/routing';
import type { SiteContext } from './site-context';

/**
 * Shared pieces of the reception-QR pages (qr-onboarding-flow §2; ADR-058).
 *
 * Inside the marketing shell like sign-up, with only the `qr` catalogue — and `signup`,
 * for the selfie sheet — sent to the browser. Never indexed: the QR is for people
 * standing at the desk.
 */

export async function qrMetadata(params: Promise<{ locale: string }>): Promise<Metadata> {
  const locale = (await params).locale as Locale;
  const t = await getTranslations({ locale, namespace: 'qr' });
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

export async function QrPage({ ctx, children }: { ctx: SiteContext; children: ReactNode }) {
  const messages = await getMessages({ locale: ctx.locale });
  return (
    <MarketingShell ctx={ctx} onHome={false}>
      <NextIntlClientProvider messages={{ qr: messages['qr'] as Record<string, unknown>, signup: messages['signup'] as Record<string, unknown> }}>
        <div className="mx-auto max-w-[var(--size-content-max)] px-5 py-10 md:px-6 md:py-16">{children}</div>
      </NextIntlClientProvider>
    </MarketingShell>
  );
}
