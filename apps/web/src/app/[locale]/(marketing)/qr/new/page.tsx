import { JoinDetails, JoinFrame } from '@/components/join/join-flow';
import { JoinPage, joinContext, joinMetadata, legalHref } from '@/lib/join-page';

/**
 * `/qr/new` — someone new, standing at reception, after scanning the QR (qr-onboarding-flow §2).
 *
 * The same details step as `/join`, marked as coming from the QR; the plan and pay steps
 * that follow are the website's, with paying at the desk offered as an equal choice.
 */

export const dynamic = 'force-dynamic';

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return joinMetadata(params);
}

export default async function QrNewPage({ params }: { params: Promise<{ locale: string }> }) {
  const ctx = await joinContext(params);
  const { privacy } = ctx.data.settings;

  return (
    <JoinPage ctx={ctx}>
      <JoinFrame step={1}>
        <JoinDetails
          today={ctx.today}
          minAge={privacy.minAge}
          noticeVersion={privacy.privacyNoticeVersion}
          termsHref={legalHref(ctx.locale, 'terms')}
          privacyHref={legalHref(ctx.locale, 'privacy')}
          planCode={null}
          fromQr
        />
      </JoinFrame>
    </JoinPage>
  );
}
