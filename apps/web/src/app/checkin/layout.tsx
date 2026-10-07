import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';
import { isLocale, type Locale } from '@/i18n/routing';
import { getContainer } from '@/lib/container';
import { loadGym } from '@/lib/gym';
import '@/styles/globals.css';

/**
 * The reception tablet's own root layout.
 *
 * Outside `[locale]` for the same reason the CRM is: this is a device standing on a desk,
 * not a page anybody browses to, and its language belongs to the gym rather than to a URL
 * somebody shared.
 *
 * **The gym's own setting decides, not a cookie** (owner, 2026-10-07). It used to take the
 * CRM's cookie, and a reception phone has no CRM cookie — nobody signs into Max Register on
 * it — so it fell through to the CRM's Hindi default no matter what the gym had chosen.
 * Settings has said "Language for new members and the attendance phone" all along; now the
 * attendance phone actually reads it, and changing it there changes this screen.
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
  // A gym that is not configured yet must still show a usable screen rather than an error
  // page at a member standing in front of it.
  const locale: Locale = await loadGym(getContainer())
    .then((gym) => (isLocale(gym.settings.defaultLanguage) ? gym.settings.defaultLanguage : 'hi'))
    .catch(() => 'hi');
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
