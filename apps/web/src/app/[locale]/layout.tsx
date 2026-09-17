import type { Metadata } from 'next';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { preload } from 'react-dom';
import { Analytics } from '@/components/marketing/analytics';
import { routing, type Locale } from '@/i18n/routing';
import { isIndexable, siteUrl } from '@/lib/seo';
import '@/styles/globals.css';

/**
 * Public-site layout.
 *
 * DESIGN-BLUEPRINT §4: Khand for display and numbers, Hind for body — both from
 * Indian Type Foundry, both carrying Devanagari, so a Hindi headline and an
 * English one share one voice instead of falling back to a system font.
 *
 * The fonts are self-hosted from `public/fonts` and declared in styles/fonts.css,
 * one face per subset (ADR-033). Each page preloads exactly what its language paints
 * first: Latin faces everywhere, plus the Devanagari faces on Hindi pages, where
 * laying out Hindi text before those faces arrived cost a ~1.7 s main-thread task.
 * `next/font` was dropped: two instances of one family emitted duplicate
 * `@font-face` sets, so every preloaded file was downloaded a second time.
 */

type FontFile = `/fonts/${string}.woff2`;

const PRELOAD_FONTS: Record<Locale, readonly FontFile[]> = {
  en: ['/fonts/hind-400-latin.v1.woff2', '/fonts/hind-600-latin.v1.woff2', '/fonts/khand-700-latin.v1.woff2'],
  hi: [
    '/fonts/hind-400-devanagari.v1.woff2',
    '/fonts/khand-700-devanagari.v1.woff2',
    '/fonts/hind-400-latin.v1.woff2',
    '/fonts/khand-700-latin.v1.woff2',
  ],
};

/**
 * Message namespaces used by client components. Only these are serialised into the
 * page; everything else is rendered on the server and never shipped to the browser.
 */
const CLIENT_NAMESPACES = ['common', 'nav', 'promo', 'hero', 'lead', 'plans', 'gallery', 'photos', 'contact', 'consent'] as const;

/**
 * No locale pages are prerendered at build time; each is rendered statically the first
 * time it is visited, then served from the cache and revalidated (ADR-032). An empty
 * array is what enables that in Next 16 without Cache Components, and it keeps
 * `next build` from needing the database.
 */
export function generateStaticParams(): Array<{ locale: string }> {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: requested } = await params;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: 'meta' });
  const tc = await getTranslations({ locale, namespace: 'common' });
  const indexable = isIndexable();

  return {
    metadataBase: new URL(siteUrl()),
    title: { default: t('title'), template: `%s | ${tc('gymName')}` },
    description: t('description'),
    // Development, previews and demo deployments carry placeholder content.
    robots: indexable ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      type: 'website',
      siteName: tc('gymName'),
      locale: locale === 'hi' ? 'hi_IN' : 'en_IN',
      title: t('title'),
      description: t('description'),
    },
    twitter: { card: 'summary_large_image' },
  };
}

export default async function LocaleLayout({
  children,
  modal,
  params,
}: {
  children: ReactNode;
  /** The intercepted sign-up modal; `@modal/default.tsx` renders null everywhere else. */
  modal: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Required for static rendering of a [locale] segment.
  setRequestLocale(locale);

  for (const href of PRELOAD_FONTS[locale]) {
    preload(href, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  }

  const messages = await getMessages();
  const clientMessages = Object.fromEntries(CLIENT_NAMESPACES.map((namespace) => [namespace, messages[namespace]]));

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={clientMessages}>
          {children}
          {/* The sign-up modal, when a route interception fills this slot; otherwise null. */}
          {modal}
          <Analytics
            plausibleDomain={process.env['NEXT_PUBLIC_PLAUSIBLE_DOMAIN'] ?? ''}
            ga4Id={process.env['NEXT_PUBLIC_GA4_ID'] ?? ''}
          />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
