import { getTranslations } from 'next-intl/server';
import { getPathname } from '@/i18n/navigation';
import { joinContext } from '@/lib/join-page';
import { QrPage, qrMetadata } from '@/lib/qr-page';

/**
 * `/qr` — what the reception poster opens (qr-onboarding-flow §1–2; ADR-058, ADR-083).
 *
 * Two choices, because both kinds of person stand at this desk: members already training
 * here send their details for the desk to check, and somebody new joins on the spot.
 * Both forms ask one question per screen and both end at the counter — the gym has no
 * live payment gateway, so nobody is asked to pay on a phone.
 */

export const dynamic = 'force-dynamic';

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return qrMetadata(params);
}

export default async function QrChoicePage({ params }: { params: Promise<{ locale: string }> }) {
  const ctx = await joinContext(params);
  const t = await getTranslations({ locale: ctx.locale, namespace: 'qr.choice' });

  // Big targets: a phone held in one hand, at a desk, often by somebody in a hurry.
  const card = 'block rounded-panel p-6 text-left shadow-sm transition-colors focus-visible:outline-offset-4';
  return (
    <QrPage ctx={ctx}>
      <h1 className="font-display text-display-m font-bold text-brand-obsidian">{t('title')}</h1>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <a href={getPathname({ href: '/qr/existing', locale: ctx.locale })} className={`${card} bg-brand-obsidian text-white`}>
          <span className="block font-display text-title font-bold">{t('existing')}</span>
          <span className="mt-2 block text-body text-white/85">{t('existingHelper')}</span>
        </a>
        <a href={getPathname({ href: '/qr/new', locale: ctx.locale })} className={`${card} bg-brand-accent text-brand-white`}>
          <span className="block font-display text-title font-bold">{t('new')}</span>
          <span className="mt-2 block text-body text-white/90">{t('newHelper')}</span>
        </a>
      </div>
    </QrPage>
  );
}
