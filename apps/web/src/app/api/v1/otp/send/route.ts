import type { NextRequest } from 'next/server';
import { sendOtp } from '@mfp/core';
import { OtpSendSchema } from '@mfp/shared';
import { apiData, apiError, newRequestId } from '@/lib/api';
import { errorResponse } from '@/lib/api-errors';
import { getContainer } from '@/lib/container';
import { loadGym } from '@/lib/gym';
import { fieldErrors, otpDeps, readSmallJson, tooMany } from '@/lib/otp-route';
import { clientIp, limiterKey, otpLimiters } from '@/lib/rate-limit';

/**
 * `POST /api/v1/otp/send` (api-specification §/otp; ADR-060).
 *
 * In DEMO_MODE the code is sent nowhere and returned as `demoCode`, so the demo works
 * without WhatsApp; live, the response never contains it.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const ipCheck = otpLimiters.sendByIp.hit(limiterKey('otp-send-ip', clientIp(request.headers)));
  if (!ipCheck.allowed) return tooMany(ipCheck.retryAfterSeconds, requestId);

  const read = await readSmallJson(request, requestId);
  if (!read.ok) return read.response;
  const parsed = OtpSendSchema.safeParse(read.body);
  if (!parsed.success) {
    return apiError(400, 'VALIDATION_FAILED', 'Some fields need attention', requestId, { details: { fields: fieldErrors(parsed.error.issues) } });
  }
  const language = (read.body as { language?: unknown }).language === 'en' ? 'en' : 'hi';

  try {
    const container = getContainer();
    const gym = await loadGym(container);
    const { expiresInSec, code } = await sendOtp({ ...parsed.data, language }, otpDeps(gym));
    return apiData({ expiresInSec, ...(container.env.DEMO_MODE ? { demoCode: code } : {}) }, requestId);
  } catch (error) {
    return errorResponse(error, requestId, 'otp-send');
  }
}
