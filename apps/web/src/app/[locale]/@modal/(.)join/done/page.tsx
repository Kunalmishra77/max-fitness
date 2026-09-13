import { JoinDone } from '@/components/join/join-flow';
import { JoinModal } from '@/components/join/join-modal';
import { JoinModalMessages, joinContext, priceLists } from '@/lib/join-page';

/**
 * The confirmation, still in the sheet when the flow was opened from the landing page.
 *
 * It has its own route because a parallel slot keeps its content across a client-side
 * navigation: without this, the pay step would stay on screen behind the confirmation.
 * Opened, refreshed or shared directly, `/join/done` is the full page.
 */

export const dynamic = 'force-dynamic';

export default async function JoinDoneModal({ params }: { params: Promise<{ locale: string }> }) {
  const ctx = await joinContext(params);

  return (
    <JoinModalMessages ctx={ctx}>
      <JoinModal>
        <JoinDone prices={priceLists(ctx)} directionsHref={ctx.contact.directionsHref} />
      </JoinModal>
    </JoinModalMessages>
  );
}
