import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPathname } from '@/i18n/navigation';
import { joinContext } from '@/lib/join-page';
import { QrPage, qrMetadata } from '@/lib/qr-page';

/**
 * `/qr/done/[ref]` — the reference code to show at the desk (qr-onboarding-flow §2).
 *
 * The code alone is on the page: it tells whoever sees the screen nothing about the
 * member, and staff match it against the queue in the CRM.
 */

export const dynamic = 'force-dynamic';

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return qrMetadata(params);
}

export default async function QrDonePage({ params }: { params: Promise<{ locale: string; ref: string }> }) {
  const { ref } = await params;
  if (!/^Q-\d{4}$/.test(ref)) notFound();

  const ctx = await joinContext(params);
  const t = await getTranslations({ locale: ctx.locale, namespace: 'qr.done' });

  return (
    <QrPage ctx={ctx}>
      <div className="mx-auto max-w-lg text-center">
        <p aria-hidden className="text-6xl">
          ✅
        </p>
        <h1 className="mt-4 font-display text-display-m font-bold text-brand-obsidian">{t('title')}</h1>
        <p className="mt-3 text-body-l leading-body">{t('helper')}</p>
        <p className="mt-8 rounded-panel bg-brand-obsidian px-6 py-8 text-white">
          <span className="block text-small tracking-wide uppercase">{t('codeLabel')}</span>
          <span className="mt-2 block font-display text-display-xl font-bold tracking-[0.15em]">{ref}</span>
        </p>
        <a
          href={getPathname({ href: '/', locale: ctx.locale })}
          className="mt-8 inline-flex min-h-14 items-center justify-center rounded-panel border-2 border-brand-obsidian px-6 text-body-l font-semibold text-brand-obsidian"
        >
          {t('home')}
        </a>
      </div>
    </QrPage>
  );
}
