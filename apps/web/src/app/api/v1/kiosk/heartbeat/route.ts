import type { NextRequest } from 'next/server';
import { recordHeartbeat } from '@mfp/core';
import { KioskHeartbeatSchema } from '@mfp/shared';
import { PrismaKioskDevices } from '@mfp/db';
import { apiData, apiError, newRequestId } from '@/lib/api';
import { getContainer } from '@/lib/container';
import { kioskCaller } from '@/lib/kiosk-auth';

/**
 * `POST /api/v1/kiosk/heartbeat` — the phone says it is still alive
 * (api-specification.md §7).
 *
 * It carries what actually goes wrong on a wall-mounted phone: heat, a dead camera, a
 * full disk, a queue that is not draining. The reply carries `serverTime`, which the
 * phone uses to correct its own clock before stamping attendance (BR-9.2), and any
 * command the server has for it.
 *
 * A revoked device is refused here like everywhere else, so it never learns anything
 * more about the gym. Its `WIPE_AND_UNPAIR` is delivered by `recordHeartbeat` only in
 * the window between the owner revoking and the token being dropped.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const caller = await kioskCaller(request);
  if (caller === null) return apiError(401, 'UNAUTHENTICATED', 'This phone is not paired', requestId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'VALIDATION_FAILED', 'Malformed request', requestId);
  }

  const parsed = KioskHeartbeatSchema.safeParse(body);
  if (!parsed.success) return apiError(400, 'VALIDATION_FAILED', 'Check the health values', requestId);

  const container = getContainer();
  const result = await recordHeartbeat(
    { deviceId: caller.deviceId, health: parsed.data },
    { clock: container.clock, store: new PrismaKioskDevices(container.prisma).heartbeatStore() },
  );
  if (!result.ok) return apiError(401, 'UNAUTHENTICATED', 'This phone is not paired', requestId);

  return apiData({ serverTime: result.serverTime.toISOString(), commands: result.commands, shadowMode: result.shadowMode }, requestId);
}
