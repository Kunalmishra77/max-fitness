import { JoinPlan } from '@/components/join/join-flow';
import { JoinModal } from '@/components/join/join-modal';
import { JoinModalMessages, PlansUnavailable, joinContext, priceLists } from '@/lib/join-page';

/** `/join/plan` reached from the modal: step 2, still over the page behind it. */

export const dynamic = 'force-dynamic';

export default async function JoinPlanModal({
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
    <JoinModalMessages ctx={ctx}>
      <JoinModal step={2}>
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
      </JoinModal>
    </JoinModalMessages>
  );
}
