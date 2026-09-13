import { JoinDetails, JoinFrame } from '@/components/join/join-flow';
import { JoinPage, joinContext, joinMetadata, legalHref } from '@/lib/join-page';

/** `/join` — step 1 of online sign-up: details, selfie and consents. */

// Reads `?plan=` and request-time data (ADR-032).
export const dynamic = 'force-dynamic';

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return joinMetadata(params);
}

export default async function JoinDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ plan?: string | string[] }>;
}) {
  const ctx = await joinContext(params);
  const { plan } = await searchParams;
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
          planCode={typeof plan === 'string' && /^M\d{1,2}_(MALE|FEMALE)$/.test(plan) ? plan : null}
        />
      </JoinFrame>
    </JoinPage>
  );
}
