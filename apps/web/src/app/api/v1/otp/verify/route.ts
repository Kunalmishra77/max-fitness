import type { NextRequest } from 'next/server';
import { verifyOtp } from '@mfp/core';
import { OtpVerifySchema } from '@mfp/shared';
import { apiData, apiError, newRequestId } from '@/lib/api';
import { errorResponse } from '@/lib/api-errors';
import { getContainer } from '@/lib/container';
import { loadGym } from '@/lib/gym';
import { fieldErrors, otpDeps, readSmallJson, tooMany } from '@/lib/otp-route';
import { clientIp, limiterKey, otpLimiters } from '@/lib/rate-limit';

/** `POST /api/v1/otp/verify` — a right code becomes a 15-minute token for this number (ADR-060). */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const ipCheck = otpLimiters.verifyByIp.hit(limiterKey('otp-verify-ip', clientIp(request.headers)));
  if (!ipCheck.allowed) return tooMany(ipCheck.retryAfterSeconds, requestId);

  const read = await readSmallJson(request, requestId);
  if (!read.ok) return read.response;
  const parsed = OtpVerifySchema.safeParse(read.body);
  if (!parsed.success) {
    return apiError(400, 'VALIDATION_FAILED', 'Some fields need attention', requestId, { details: { fields: fieldErrors(parsed.error.issues) } });
  }

  try {
    const gym = await loadGym(getContainer());
    return apiData(await verifyOtp(parsed.data, otpDeps(gym)), requestId);
  } catch (error) {
    return errorResponse(error, requestId, 'otp-verify');
  }
}
