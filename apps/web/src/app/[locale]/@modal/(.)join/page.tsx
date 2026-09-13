import { JoinDetails } from '@/components/join/join-flow';
import { JoinModal } from '@/components/join/join-modal';
import { JoinModalMessages, joinContext, legalHref } from '@/lib/join-page';

/** `/join` opened from the landing page: step 1 in a modal, without leaving the page. */

export const dynamic = 'force-dynamic';

export default async function JoinDetailsModal({
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
    <JoinModalMessages ctx={ctx}>
      <JoinModal step={1}>
        <JoinDetails
          today={ctx.today}
          minAge={privacy.minAge}
          noticeVersion={privacy.privacyNoticeVersion}
          termsHref={legalHref(ctx.locale, 'terms')}
          privacyHref={legalHref(ctx.locale, 'privacy')}
          planCode={typeof plan === 'string' && /^M\d{1,2}_(MALE|FEMALE)$/.test(plan) ? plan : null}
        />
      </JoinModal>
    </JoinModalMessages>
  );
}
