import { sessionsForDay } from '@mfp/core';
import { GymAtAGlance } from '@/components/qr/gym-at-a-glance';
import { QrNewPageFlow } from '@/components/qr/qr-new-page-flow';
import type { QrPlanCard } from '@/components/qr/qr-new-form';
import { JoinPage, joinContext, joinMetadata, legalHref, priceLists } from '@/lib/join-page';

/**
 * `/qr/new` — somebody new, standing at reception, after scanning the QR
 * (qr-onboarding-flow §2; ADR-075, ADR-083).
 *
 * The gym comes first and the form second. Someone who has just scanned a poster on a
 * wall knows nothing about this place: asking for their date of birth before telling
 * them what a month costs is the wrong way round, and the client said so.
 *
 * One question per screen, like the existing-member form, and the money is handed over
 * at the counter — this does not go through the website's three-page checkout.
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

  // The form shows only the plans for the gender the member gives, so both lists go down.
  const lists = priceLists(ctx);
  const plans: QrPlanCard[] = (['MALE', 'FEMALE'] as const).flatMap((gender) =>
    lists[gender].cards.map((card) => ({ planId: card.planId, durationMonths: card.durationMonths, pricePaise: card.pricePaise, gender })),
  );
  // Personal training, the same way (ADR-087): empty and the question is never asked.
  const ptPlans: QrPlanCard[] = (['MALE', 'FEMALE'] as const).flatMap((gender) =>
    lists[gender].ptCards.map((card) => ({ planId: card.planId, durationMonths: card.durationMonths, pricePaise: card.pricePaise, gender })),
  );

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

        <QrNewPageFlow
          today={ctx.today}
          minAge={privacy.minAge}
          noticeVersion={privacy.privacyNoticeVersion}
          termsHref={legalHref(ctx.locale, 'terms')}
          privacyHref={legalHref(ctx.locale, 'privacy')}
          plans={plans}
          ptPlans={ptPlans}
          admissionFeePaise={pricing.admissionFeePaise}
        />
      </div>
    </JoinPage>
  );
}
