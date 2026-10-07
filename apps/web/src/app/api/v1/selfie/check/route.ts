import type { NextRequest } from 'next/server';
import { apiData, apiError, newRequestId } from '@/lib/api';
import { getContainer } from '@/lib/container';
import { loadGym } from '@/lib/gym';
import { clientIp, limiterKey, selfieCheckLimiters } from '@/lib/rate-limit';
import { checkSelfieFace } from '@/lib/selfie-face-gate';
import { MAX_SELFIE_BYTES, processSelfie, SelfieRejectedError } from '@/lib/selfie-image';

/**
 * `POST /api/v1/selfie/check` — will this photograph recognise the member later? (owner,
 * 2026-10-07)
 *
 * The same gate the sign-up and QR routes run, moved to where the member can still do
 * something about it. It used to run only when the whole form was sent: a member filled in
 * eight screens, pressed the button and was told their photograph was taken from too far
 * away — three screens back, with the camera closed. Now the answer arrives while they are
 * still looking at the picture they just took.
 *
 * **Nothing is kept.** No name, no number, no row, no object in storage. The image is
 * re-encoded in memory, measured by the gym's own engine on the gym's own private network,
 * and gone when the response is written. It is not an enrolment and it is not a sign-up;
 * the real gate still runs on submission, because a check anybody can call is not a thing
 * to trust a register to.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  const ipCheck = selfieCheckLimiters.byIp.hit(limiterKey('selfie-check-ip', clientIp(request.headers)));
  if (!ipCheck.allowed) {
    return apiError(429, 'RATE_LIMITED', 'Too many requests', requestId, {
      details: { retryAfterSeconds: ipCheck.retryAfterSeconds },
      headers: { 'Retry-After': String(ipCheck.retryAfterSeconds) },
    });
  }

  if (Number(request.headers.get('content-length') ?? '0') > MAX_SELFIE_BYTES) {
    return apiError(413, 'PAYLOAD_TOO_LARGE', 'Photo too large', requestId);
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('selfie');
  if (!(file instanceof Blob) || file.size === 0) {
    return apiError(400, 'VALIDATION_FAILED', 'A photo is required', requestId);
  }
  if (file.size > MAX_SELFIE_BYTES) return apiError(413, 'PAYLOAD_TOO_LARGE', 'Photo too large', requestId);

  const container = getContainer();
  let selfie;
  try {
    selfie = await processSelfie(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    // Refused before the engine ever sees it — the wrong kind of file, or not a picture at
    // all. Its own reason is carried through, so the screen has one vocabulary of refusals
    // rather than two.
    if (error instanceof SelfieRejectedError) return apiData({ ok: false as const, reason: error.reason }, requestId);
    throw error;
  }

  const gym = await loadGym(container);
  const verdict = await checkSelfieFace(selfie.body, gym.settings.attendance);

  // An unreachable engine answers `ok` with nothing measured, exactly as it does on
  // sign-up: a member must never be stopped because a container is restarting.
  return apiData(verdict.ok ? { ok: true as const } : { ok: false as const, reason: verdict.reason }, requestId);
}
