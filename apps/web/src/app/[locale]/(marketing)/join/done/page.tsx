import { JoinDone, JoinFrame } from '@/components/join/join-flow';
import { JoinPage, joinContext, joinMetadata, priceLists } from '@/lib/join-page';

/** `/join/done` — confirmation of a payment or a reservation. */

export const dynamic = 'force-dynamic';

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return joinMetadata(params);
}

export default async function JoinDonePage({ params }: { params: Promise<{ locale: string }> }) {
  const ctx = await joinContext(params);

  return (
    <JoinPage ctx={ctx}>
      <JoinFrame step={null}>
        <JoinDone prices={priceLists(ctx)} directionsHref={ctx.contact.directionsHref} />
      </JoinFrame>
    </JoinPage>
  );
}
