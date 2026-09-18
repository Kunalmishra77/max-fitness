import type { NextRequest } from 'next/server';
import { checkOtpToken, qrCandidateView } from '@mfp/core';
import { PrismaQrLookup } from '@mfp/db';
import { QrLookupSchema } from '@mfp/shared';
import { apiData, apiError, newRequestId } from '@/lib/api';
import { errorResponse } from '@/lib/api-errors';
import { getContainer } from '@/lib/container';
import { loadGym } from '@/lib/gym';
import { fieldErrors, readSmallJson, tooMany } from '@/lib/otp-route';
import { clientIp, limiterKey, otpLimiters } from '@/lib/rate-limit';

/**
 * `POST /api/v1/qr/lookup` — register entries on a number proven by OTP (api-specification
 * §/qr/lookup; ADR-060). Without a valid token it answers 401 and names nobody (ADR-058).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const ipCheck = otpLimiters.lookupByIp.hit(limiterKey('qr-lookup-ip', clientIp(request.headers)));
  if (!ipCheck.allowed) return tooMany(ipCheck.retryAfterSeconds, requestId);

  const read = await readSmallJson(request, requestId);
  if (!read.ok) return read.response;
  const parsed = QrLookupSchema.safeParse(read.body);
  if (!parsed.success) {
    return apiError(400, 'VALIDATION_FAILED', 'Some fields need attention', requestId, { details: { fields: fieldErrors(parsed.error.issues) } });
  }

  try {
    const container = getContainer();
    const { clock, env, prisma } = container;
    if (!checkOtpToken(parsed.data.otpToken, { mobile: parsed.data.mobile, purpose: 'QR_EXISTING' }, { clock, secret: env.LINK_TOKEN_SECRET })) {
      return apiError(401, 'OTP_REQUIRED', 'Confirm the mobile number first', requestId);
    }
    const gym = await loadGym(container);
    const records = await new PrismaQrLookup(prisma).candidates(gym.id, parsed.data.mobile);
    return apiData({ candidates: records.map(qrCandidateView) }, requestId);
  } catch (error) {
    return errorResponse(error, requestId, 'qr-lookup');
  }
}
