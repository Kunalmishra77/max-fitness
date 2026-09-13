import { JoinFrame, JoinPlan } from '@/components/join/join-flow';
import { JoinPage, PlansUnavailable, joinContext, joinMetadata, priceLists } from '@/lib/join-page';

/** `/join/plan` — step 2: plan and start date. */

export const dynamic = 'force-dynamic';

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return joinMetadata(params);
}

export default async function JoinPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ plan?: string | string[] }>;
}) {
  const ctx = await joinContext(params);
  const { plan } = await searchParams;
  const { settings, available } = ctx.data;

  return (
    <JoinPage ctx={ctx}>
      <JoinFrame step={2}>
        {available ? (
          <JoinPlan
            prices={priceLists(ctx)}
            admissionPaise={settings.pricing.admissionFeePaise}
            today={ctx.today}
            maxStartDateDaysAhead={settings.membership.maxStartDateDaysAhead}
            planCode={typeof plan === 'string' ? plan : null}
          />
        ) : (
          <PlansUnavailable ctx={ctx} />
        )}
      </JoinFrame>
    </JoinPage>
  );
}
