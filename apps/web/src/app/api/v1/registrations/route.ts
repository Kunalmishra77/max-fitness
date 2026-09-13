import type { NextRequest } from 'next/server';
import { registerMember } from '@mfp/core';
import { apiData, apiError, newRequestId } from '@/lib/api';
import { errorResponse } from '@/lib/api-errors';
import { getContainer } from '@/lib/container';
import { loadGym } from '@/lib/gym';
import { clientIp, limiterKey, registrationLimiters } from '@/lib/rate-limit';
import { parseRegistrationForm } from '@/lib/registration-form';
import { MAX_SELFIE_BYTES, processSelfie } from '@/lib/selfie-image';
import { hashIp } from '@/lib/signup-access';

/**
 * `POST /api/v1/registrations` — the details and selfie step of online sign-up
 * (PRD SU-02…SU-09; api-specification.md §3).
 *
 * The IP limit comes before the body is read; the multipart fields go through the
 * shared schema; the per-mobile limit follows; the selfie is decoded and re-encoded
 * (never stored as uploaded); and `registerMember` in packages/core writes the member,
 * photo and consents in one transaction.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The selfie plus a few hundred bytes of fields and multipart framing. */
const MAX_BODY_BYTES = MAX_SELFIE_BYTES + 64 * 1024;
const MAX_USER_AGENT = 300;

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const ip = clientIp(request.headers);

  const ipCheck = registrationLimiters.byIp.hit(limiterKey('registration-ip', ip));
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

  const parsed = await parseRegistrationForm(form);
  if (!parsed.ok) {
    return apiError(400, 'VALIDATION_FAILED', 'Some fields need attention', requestId, { details: { fields: parsed.fields } });
  }

  // Already E.164 after the schema, so every spelling of one number shares a bucket.
  const mobileCheck = registrationLimiters.byMobile.hit(limiterKey('registration-mobile', parsed.fields.mobile));
  if (!mobileCheck.allowed) return tooMany(mobileCheck.retryAfterSeconds, requestId);

  try {
    const container = getContainer();
    const { clock, env, storage, registrationUow } = container;
    const selfie = await processSelfie(parsed.selfie);
    const gym = await loadGym(container);

    const result = await registerMember(parsed.fields, selfie, {
      clock,
      uow: registrationUow,
      storage,
      tokenSecret: env.LINK_TOKEN_SECRET,
      gymId: gym.id,
      minAge: gym.settings.privacy.minAge,
      channel: 'web_signup',
      source: 'WEBSITE',
      ipHash: hashIp(ip, env.LINK_TOKEN_SECRET),
      userAgent: request.headers.get('user-agent')?.slice(0, MAX_USER_AGENT) ?? null,
    });

    return apiData(result, requestId, 201);
  } catch (error) {
    return errorResponse(error, requestId, 'registrations');
  }
}

function tooMany(retryAfterSeconds: number, requestId: string) {
  return apiError(429, 'RATE_LIMITED', 'Too many requests', requestId, {
    details: { retryAfterSeconds },
    headers: { 'Retry-After': String(retryAfterSeconds) },
  });
}
