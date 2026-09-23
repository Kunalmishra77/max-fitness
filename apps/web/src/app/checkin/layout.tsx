import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';
import { getCrmLocale } from '@/i18n/crm-locale';
import '@/styles/globals.css';

/**
 * The reception tablet's own root layout.
 *
 * Outside `[locale]` for the same reason the CRM is: this is a device standing on a
 * desk, not a page anybody browses to, and its language belongs to the gym rather
 * than to a URL somebody shared. It takes the same cookie the CRM takes, so changing
 * the language in Max Register changes this screen too.
 */

export const metadata: Metadata = {
  title: 'Max Fitness — Attendance',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#0A0A0B',
  // A member taps this standing up: the keys must not shrink.
  maximumScale: 5,
};

export default async function CheckInLayout({ children }: { children: ReactNode }) {
  const locale = await getCrmLocale();
  const messages = await getMessages({ locale });

  return (
    <html lang={locale}>
      <body className="bg-brand-paper text-brand-ink">
        <NextIntlClientProvider locale={locale} messages={{ checkin: messages['checkin'] as Record<string, unknown> }} timeZone="Asia/Kolkata">
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
