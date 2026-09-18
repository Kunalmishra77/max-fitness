import { getTranslations } from 'next-intl/server';
import { QrExistingPageFlow } from '@/components/qr/qr-existing-page-flow';
import { joinContext, legalHref } from '@/lib/join-page';
import { QrPage, qrMetadata } from '@/lib/qr-page';

/** `/qr/existing` — an existing member tells reception who they are (qr-onboarding-flow §3). */

export const dynamic = 'force-dynamic';

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return qrMetadata(params);
}

export default async function QrExistingPage({ params }: { params: Promise<{ locale: string }> }) {
  const ctx = await joinContext(params);
  const t = await getTranslations({ locale: ctx.locale, namespace: 'qr.existing' });
  const { privacy } = ctx.data.settings;

  return (
    <QrPage ctx={ctx}>
      <h1 className="mb-6 font-display text-display-m font-bold text-brand-plate-navy">{t('title')}</h1>
      <QrExistingPageFlow
        today={ctx.today}
        minAge={privacy.minAge}
        noticeVersion={privacy.privacyNoticeVersion}
        termsHref={legalHref(ctx.locale, 'terms')}
        privacyHref={legalHref(ctx.locale, 'privacy')}
      />
    </QrPage>
  );
}
