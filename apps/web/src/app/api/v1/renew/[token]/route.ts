import type { NextRequest } from 'next/server';
import { apiData, newRequestId } from '@/lib/api';
import { errorResponse } from '@/lib/api-errors';
import { getContainer } from '@/lib/container';
import { loadRenewalOffer } from '@/lib/renewal-offer';

/**
 * `GET /api/v1/renew/{token}` — what a renew link shows before payment
 * (api-specification.md §3; BR-3.4).
 *
 * The token names the member; the response greets them by first name, lists their
 * price list and proposes the start date the renewal rule will use. The order itself
 * is priced and dated again at `/checkout/orders`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const requestId = newRequestId();
  try {
    const { token } = await context.params;
    const offer = await loadRenewalOffer(getContainer(), token);
    return apiData(
      {
        member: { firstName: offer.firstName, gender: offer.gender, photoUrl: offer.photoUrl },
        currentEndDate: offer.currentEndDate,
        plans: offer.cards,
        deskConfirmsPrice: offer.deskConfirmsPrice,
        proposedStartDate: offer.proposedStartDate,
      },
      requestId,
    );
  } catch (error) {
    return errorResponse(error, requestId, 'renew');
  }
}
