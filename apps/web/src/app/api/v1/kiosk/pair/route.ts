import type { NextRequest } from 'next/server';
import { pairKioskDevice } from '@mfp/core';
import { KioskPairSchema } from '@mfp/shared';
import { PrismaKioskDevices } from '@mfp/db';
import { apiData, apiError, newRequestId } from '@/lib/api';
import { getContainer } from '@/lib/container';
import { loadGym } from '@/lib/gym';

/**
 * `POST /api/v1/kiosk/pair` — trade a six-digit code for a device token
 * (api-specification.md §7; security-plan §3.4).
 *
 * The only kiosk endpoint without a bearer token, because it is where the bearer token
 * comes from. The code was shown once in Max Register and lives ten minutes; the token
 * it returns is shown once here and is never readable again — the server keeps only a
 * peppered hash of it.
 *
 * Every refusal answers the same way, with the same 401 and no detail. A phone that
 * mistyped a digit and a phone fishing for codes should not be able to tell each other
 * apart from the outside.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const container = getContainer();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'VALIDATION_FAILED', 'Malformed request', requestId);
  }

  const parsed = KioskPairSchema.safeParse(body);
  if (!parsed.success) return apiError(400, 'VALIDATION_FAILED', 'Check the pairing details', requestId);

  const devices = new PrismaKioskDevices(container.prisma);
  const result = await pairKioskDevice(parsed.data, {
    clock: container.clock,
    pepper: container.env.KIOSK_TOKEN_PEPPER,
    store: devices.pairingStore(),
  });

  if (result.outcome !== 'PAIRED') {
    // Deliberately one answer for "wrong code", "expired" and "revoked".
    console.warn(`[kiosk-pair] refused ${requestId}: ${result.outcome}`);
    return apiError(401, 'UNAUTHENTICATED', 'That code did not work. Ask for a new one.', requestId);
  }

  const gym = await loadGym(container);
  const { attendance } = gym.settings;

  return apiData(
    {
      deviceId: result.deviceId,
      deviceToken: result.deviceToken,
      gymName: gym.name,
      settings: {
        cooldownMinutes: attendance.checkInCooldownMinutes,
        // A newly paired phone always starts in shadow mode: it watches and records
        // but greets nobody, until the owner has seen it get people right (§6).
        shadowMode: true,
        acceptThreshold: attendance.acceptThreshold,
        confirmBand: attendance.confirmBand,
        matchMargin: attendance.matchMargin,
        framesToAgree: attendance.framesToAgree,
        voice: attendance.kioskVoice,
        language: gym.settings.defaultLanguage,
      },
    },
    requestId,
    201,
  );
}
