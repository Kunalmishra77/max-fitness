import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { PlansQuerySchema, type Gender } from '@mfp/shared';
import { needsDeskPriceConfirmation, planCards } from '@mfp/core';
import { apiError, newRequestId } from '@/lib/api';
import { getLandingData } from '@/lib/landing-data';

/**
 * `GET /api/v1/plans?gender=` — the plan step's price list (api-specification.md §3).
 *
 * Served from the same 5-minute cached read as the landing fee board (tags `plans`,
 * `settings`), so both always show the same prices and a CRM price edit refreshes both.
 * These figures are for display: an order is priced again on the server at checkout.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GENDERS: readonly Gender[] = ['MALE', 'FEMALE'];

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const query = PlansQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) {
    return apiError(400, 'VALIDATION_FAILED', 'Unknown gender', requestId, { details: { fields: { gender: 'gender' } } });
  }

  const landing = await getLandingData();
  if (!landing.available) {
    return apiError(503, 'INTERNAL', 'Plans are unavailable right now', requestId, { headers: { 'Retry-After': '30' } });
  }

  const { pricing, membership } = landing.settings;
  const genders = query.data.gender === undefined ? GENDERS : [query.data.gender];
  const byGender = Object.fromEntries(
    genders.map((gender) => [
      gender,
      {
        cards: planCards(landing.plans, gender, pricing),
        // BR-2.5: `OTHER` sees a price list the desk confirms.
        deskConfirmsPrice: needsDeskPriceConfirmation(gender, pricing.otherGenderPricing),
      },
    ]),
  );

  return NextResponse.json(
    {
      data: {
        plans: byGender,
        admissionPaise: pricing.admissionFeePaise,
        currency: 'INR',
        maxStartDateDaysAhead: membership.maxStartDateDaysAhead,
      },
      meta: { requestId },
    },
    { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' } },
  );
}
