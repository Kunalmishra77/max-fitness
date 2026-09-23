import type { NextRequest } from 'next/server';
import { selfCheckIn } from '@mfp/core';
import { CheckInAttendanceSchema, GymSettingsSchema, todayIST } from '@mfp/shared';
import { PrismaCheckIn } from '@mfp/db';
import { apiData, apiError, newRequestId } from '@/lib/api';
import { getContainer } from '@/lib/container';
import { kioskCaller } from '@/lib/kiosk-auth';

/**
 * `POST /api/v1/checkin/attendance` — mark this member in (BR-9).
 *
 * The tablet says who and how it recognised them; every rule that decides whether the
 * visit counts lives in the core. A repeat inside the cooldown, or the same tap
 * arriving twice, answers cheerfully and writes nothing — the member should never be
 * left tapping a button that appears to do nothing.
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

  const parsed = CheckInAttendanceSchema.safeParse(body);
  if (!parsed.success) return apiError(400, 'VALIDATION_FAILED', 'Check the request', requestId);

  const container = getContainer();
  const today = todayIST(container.clock);
  const gym = await container.prisma.gym.findUniqueOrThrow({ where: { id: caller.gymId }, select: { settings: true } });
  const settings = GymSettingsSchema.parse(gym.settings);

  const result = await selfCheckIn(
    { gymId: caller.gymId, memberId: parsed.data.memberId, clientEventId: parsed.data.clientEventId, method: parsed.data.method },
    {
      clock: container.clock,
      cooldownMinutes: settings.attendance.checkInCooldownMinutes,
      // The tablet's own shadow-mode flag, not the gym's: one tablet may still be
      // being trusted while another is already greeting.
      shadowMode: caller.shadowMode,
      uow: new PrismaCheckIn(container.prisma).unitOfWork(today),
    },
  );

  if (result.decision === 'NOT_FOUND') return apiError(404, 'NOT_FOUND', 'No such member', requestId);

  return apiData(
    { decision: result.decision, greeting: result.greeting, memberName: result.memberName },
    requestId,
    result.decision === 'RECORD' ? 201 : 200,
  );
}
