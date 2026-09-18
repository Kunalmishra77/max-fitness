import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

/**
 * What the installed CRM shows with no network (crm-ux-blueprint §15, §18).
 *
 * The service worker keeps this one page, so the owner sees the gym's own words in
 * Hindi rather than the browser's error. It asks for nothing and shows nothing about any
 * member — it is cached on the phone, so it must be safe to leave there.
 */

export const metadata = { robots: { index: false, follow: false } };

export default async function CrmOfflinePage() {
  const t = await getTranslations('crm.offline');

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <span aria-hidden className="text-5xl">
        📶
      </span>
      <h1 className="font-display text-display-m font-bold text-brand-obsidian">{t('title')}</h1>
      <p className="text-crm-body text-brand-stone">{t('body')}</p>
      {/* A plain link, not a button: it must work with no JavaScript running. */}
      <Link href="/crm" className="mt-2 flex min-h-14 w-full max-w-xs items-center justify-center rounded-panel bg-brand-obsidian text-crm-body font-bold text-white">
        {t('retry')}
      </Link>
    </main>
  );
}
