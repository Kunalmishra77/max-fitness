import type { NextRequest } from 'next/server';
import { PrismaExistingMemberUnitOfWork } from '@mfp/db';
import { submitExistingMember } from '@mfp/core';
import { apiData, apiError, newRequestId } from '@/lib/api';
import { errorResponse } from '@/lib/api-errors';
import { getContainer } from '@/lib/container';
import { loadGym } from '@/lib/gym';
import { parseQrExistingForm } from '@/lib/qr-existing-form';
import { clientIp, limiterKey, registrationLimiters } from '@/lib/rate-limit';
import { MAX_SELFIE_BYTES, processSelfie } from '@/lib/selfie-image';
import { hashIp } from '@/lib/signup-access';

/**
 * `POST /api/v1/qr/existing` — an existing member's details from the reception QR
 * (api-specification.md; qr-onboarding-flow §3; ADR-058).
 *
 * The same order as sign-up: the IP limit before the body is read, the shared schema,
 * the per-mobile limit, the selfie re-encoded, then the domain service. The answer is
 * the reference code the member shows at the desk — never whether that number or name
 * is already known.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = MAX_SELFIE_BYTES + 64 * 1024;
const MAX_USER_AGENT = 300;

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const ip = clientIp(request.headers);

  // The QR shares sign-up's limits (api-specification §8: 10/h per IP, 3/h per mobile).
  const ipCheck = registrationLimiters.byIp.hit(limiterKey('qr-ip', ip));
  if (!ipCheck.allowed) return tooMany(ipCheck.retryAfterSeconds, requestId);

  if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) {
    return apiError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large', requestId);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError(400, 'VALIDATION_FAILED', 'Request body must be multipart form data', requestId);
  }

  const parsed = await parseQrExistingForm(form);
  if (!parsed.ok) {
    return apiError(400, 'VALIDATION_FAILED', 'Some fields need attention', requestId, { details: { fields: parsed.fields } });
  }

  const mobileCheck = registrationLimiters.byMobile.hit(limiterKey('qr-mobile', parsed.fields.mobile));
  if (!mobileCheck.allowed) return tooMany(mobileCheck.retryAfterSeconds, requestId);

  try {
    const container = getContainer();
    const { clock, env, storage, prisma } = container;
    const selfie = await processSelfie(parsed.selfie);
    const gym = await loadGym(container);

    const result = await submitExistingMember(
      {
        fields: parsed.fields,
        selfie,
        declaredPlanMonths: parsed.declaredPlanMonths,
        declaredEndDate: parsed.declaredEndDate,
        declaredAmountPaise: parsed.declaredAmountPaise,
      },
      {
        clock,
        uow: new PrismaExistingMemberUnitOfWork(prisma),
        storage,
        gymId: gym.id,
        minAge: gym.settings.privacy.minAge,
        ipHash: hashIp(ip, env.LINK_TOKEN_SECRET),
        userAgent: request.headers.get('user-agent')?.slice(0, MAX_USER_AGENT) ?? null,
      },
    );

    return apiData({ referenceCode: result.referenceCode, status: 'PENDING_VERIFICATION', matchedExisting: result.matchedExisting }, requestId, 201);
  } catch (error) {
    return errorResponse(error, requestId, 'qr-existing');
  }
}

function tooMany(retryAfterSeconds: number, requestId: string) {
  return apiError(429, 'RATE_LIMITED', 'Too many requests', requestId, {
    details: { retryAfterSeconds },
    headers: { 'Retry-After': String(retryAfterSeconds) },
  });
}
