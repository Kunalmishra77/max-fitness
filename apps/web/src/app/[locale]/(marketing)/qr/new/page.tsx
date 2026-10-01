import { sessionsForDay } from '@mfp/core';
import { JoinDetails, JoinFrame } from '@/components/join/join-flow';
import { GymAtAGlance } from '@/components/qr/gym-at-a-glance';
import { JoinPage, joinContext, joinMetadata, legalHref, priceLists } from '@/lib/join-page';

/**
 * `/qr/new` — somebody new, standing at reception, after scanning the QR
 * (qr-onboarding-flow §2; ADR-075).
 *
 * The gym comes first and the form second. Someone who has just scanned a poster on a
 * wall knows nothing about this place: asking for their date of birth before telling
 * them what a month costs is the wrong way round, and the client said so.
 */

export const dynamic = 'force-dynamic';

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return joinMetadata(params);
}

export default async function QrNewPage({ params }: { params: Promise<{ locale: string }> }) {
  const ctx = await joinContext(params);
  const { privacy, pricing, trust, hours } = ctx.data.settings;

  // Every session, so somebody reading this at three in the afternoon is not told the
  // gym is open when its shutters are down (ADR-082).
  const openDay = hours.find((day) => !day.closed)?.day;
  const sessions = openDay === undefined ? [] : sessionsForDay(hours, openDay);
  const hoursLine = sessions.length === 0 ? null : sessions.map((session) => `${session.open} – ${session.close}`).join(', ');

  return (
    <JoinPage ctx={ctx}>
      <div className="grid gap-8">
        <GymAtAGlance
          locale={ctx.locale}
          prices={priceLists(ctx)}
          hoursLine={hoursLine}
          rating={trust.googleRating}
          reviews={trust.googleReviews}
          admissionFeePaise={pricing.admissionFeePaise}
        />

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
      </div>
    </JoinPage>
  );
}
