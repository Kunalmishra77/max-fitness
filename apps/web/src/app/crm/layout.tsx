import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ServiceWorkerRegistrar } from '@/components/crm/service-worker-registrar';
import { getCrmLocale } from '@/i18n/crm-locale';
import '@/styles/globals.css';

/**
 * Max Register's own root layout.
 *
 * The CRM is not under `[locale]`: staff should not be able to land on the
 * wrong-language CRM from a shared link, so the language comes from a cookie and
 * defaults to Hindi — the owner's language (CLAUDE.md §2.9).
 *
 * It is never indexed, and it is built for a phone held one-handed at a busy desk:
 * large text, big targets, no horizontal scrolling.
 */

export const metadata: Metadata = {
  title: 'Max Register',
  robots: { index: false, follow: false },
  // Only the CRM offers the install: the website is not the thing the owner keeps on
  // their home screen (crm-ux-blueprint §18).
  manifest: '/crm/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Max Register', statusBarStyle: 'black-translucent' },
  icons: { apple: '/icons/max-192.png' },
};

export const viewport: Viewport = {
  themeColor: '#1B2A41',
  // The CRM is a working tool; letting it zoom out makes 56px targets small again.
  maximumScale: 5,
};

export default async function CrmRootLayout({ children }: { children: ReactNode }) {
  const locale = await getCrmLocale();
  const messages = await getMessages({ locale });

  return (
    <html lang={locale}>
      <body className="bg-semantic-surface-crm-alt text-brand-ink">
        <NextIntlClientProvider locale={locale} messages={{ crm: messages['crm'] as Record<string, unknown> }} timeZone="Asia/Kolkata">
          {children}
          <ServiceWorkerRegistrar />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
