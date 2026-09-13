import { JoinPay } from '@/components/join/join-flow';
import { JoinModal } from '@/components/join/join-modal';
import { JoinModalMessages, PlansUnavailable, joinContext, priceLists } from '@/lib/join-page';

/**
 * `/join/pay` reached from the modal: step 3. The confirmation at `/join/done` is a full
 * page — a new membership deserves the whole screen, not a sheet over the landing page.
 */

export const dynamic = 'force-dynamic';

export default async function JoinPayModal({ params }: { params: Promise<{ locale: string }> }) {
  const ctx = await joinContext(params);

  return (
    <JoinModalMessages ctx={ctx}>
      <JoinModal step={3}>
        {ctx.data.available ? (
          <JoinPay prices={priceLists(ctx)} admissionPaise={ctx.data.settings.pricing.admissionFeePaise} phoneDisplay={ctx.contact.phoneDisplay} />
        ) : (
          <PlansUnavailable ctx={ctx} />
        )}
      </JoinModal>
    </JoinModalMessages>
  );
}
