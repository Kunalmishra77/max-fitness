import type { NextRequest } from 'next/server';
import { checkInCandidates } from '@mfp/core';
import { CheckInLookupSchema, todayIST } from '@mfp/shared';
import { PrismaCheckIn } from '@mfp/db';
import { apiData, apiError, newRequestId } from '@/lib/api';
import { getContainer } from '@/lib/container';
import { kioskCaller } from '@/lib/kiosk-auth';
import { signedPhotoUrl } from '@/lib/checkin-photo';

/**
 * `POST /api/v1/checkin/lookup` — who is this number? (BR-9.4.)
 *
 * Behind the tablet's device token, and that is the point: a member's name and photo
 * must not be available to anyone who can reach the URL and guess a number. The
 * tablet is paired once with a six-digit code, exactly like a kiosk (ADR-071), and
 * keeps its token from then on.
 *
 * Only a whole number or a whole member code answers. A prefix is not a lookup, it is
 * somebody fishing for names, and the core refuses it as well as the SQL.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const caller = await kioskCaller(request);
  if (caller === null) return apiError(401, 'UNAUTHENTICATED', 'This tablet is not paired', requestId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'VALIDATION_FAILED', 'Malformed request', requestId);
  }

  const parsed = CheckInLookupSchema.safeParse(body);
  if (!parsed.success) return apiError(400, 'VALIDATION_FAILED', 'Type the whole number, or the member code', requestId);

  const query = {
    ...(parsed.data.mobile === undefined ? {} : { mobile: parsed.data.mobile }),
    ...(parsed.data.memberCode === undefined ? {} : { memberCode: parsed.data.memberCode }),
  };

  const container = getContainer();
  const today = todayIST(container.clock);
  const members = await new PrismaCheckIn(container.prisma).lookup(caller.gymId, today, query);
  const candidates = checkInCandidates(members, query);

  return apiData(
    {
      candidates: await Promise.all(
        candidates.map(async (candidate) => ({
          memberId: candidate.memberId,
          fullName: candidate.fullName,
          photoUrl: await signedPhotoUrl(candidate.photoKey),
        })),
      ),
    },
    requestId,
  );
}
