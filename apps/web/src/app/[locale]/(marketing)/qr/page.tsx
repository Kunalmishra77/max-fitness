import { getTranslations } from 'next-intl/server';
import { getPathname } from '@/i18n/navigation';
import { joinContext } from '@/lib/join-page';
import { QrPage, qrMetadata } from '@/lib/qr-page';

/**
 * `/qr` — what the reception poster opens (qr-onboarding-flow §1–2; ADR-058).
 *
 * Two big choices: members already training here send their details for the desk to
 * check; new people sign up on `/qr/new`, where paying at reception is an equal choice.
 */

export const dynamic = 'force-dynamic';

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return qrMetadata(params);
}

export default async function QrChoicePage({ params }: { params: Promise<{ locale: string }> }) {
  const ctx = await joinContext(params);
  const t = await getTranslations({ locale: ctx.locale, namespace: 'qr.choice' });

  const card = 'block rounded-panel p-6 text-left shadow-sm transition-colors focus-visible:outline-offset-4';
  return (
    <QrPage ctx={ctx}>
      <h1 className="font-display text-display-m font-bold text-brand-plate-navy">{t('title')}</h1>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <a href={getPathname({ href: '/qr/existing', locale: ctx.locale })} className={`${card} bg-brand-plate-navy text-white`}>
          <span className="block font-display text-title font-bold">{t('existing')}</span>
          <span className="mt-2 block text-body text-white/85">{t('existingHelper')}</span>
        </a>
        <a
          href={getPathname({ href: '/qr/new', locale: ctx.locale })}
          className={`${card} bg-brand-signboard-red text-white`}
        >
          <span className="font-display text-title block font-bold">{t('new')}</span>
          <span className="text-body mt-2 block text-white/90">{t('newHelper')}</span>
        </a>
      </div>
    </QrPage>
  );
}
