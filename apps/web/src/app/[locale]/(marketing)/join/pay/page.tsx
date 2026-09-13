import { JoinFrame, JoinPay } from '@/components/join/join-flow';
import { JoinPage, PlansUnavailable, joinContext, joinMetadata, priceLists } from '@/lib/join-page';

/** `/join/pay` — step 3: pay online or reserve and pay at reception. */

export const dynamic = 'force-dynamic';

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return joinMetadata(params);
}

export default async function JoinPayPage({ params }: { params: Promise<{ locale: string }> }) {
  const ctx = await joinContext(params);

  return (
    <JoinPage ctx={ctx}>
      <JoinFrame step={3}>
        {ctx.data.available ? (
          <JoinPay prices={priceLists(ctx)} admissionPaise={ctx.data.settings.pricing.admissionFeePaise} phoneDisplay={ctx.contact.phoneDisplay} />
        ) : (
          <PlansUnavailable ctx={ctx} />
        )}
      </JoinFrame>
    </JoinPage>
  );
}
