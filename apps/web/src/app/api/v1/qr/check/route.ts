import type { NextRequest } from 'next/server';
import { isGovIdType } from '@mfp/core';
import { GymSettingsSchema, normaliseIndianMobile } from '@mfp/shared';
import { apiData, apiError, newRequestId } from '@/lib/api';
import { getContainer } from '@/lib/container';
import { alreadyAMember } from '@/lib/duplicate-member';
import { checkGovIdPhoto } from '@/lib/gov-id-gate';
import { loadGym } from '@/lib/gym';
import { clientIp, limiterKey, qrCheckLimiters } from '@/lib/rate-limit';
import { checkSelfieFace } from '@/lib/selfie-face-gate';
import { MAX_SELFIE_BYTES, processSelfie } from '@/lib/selfie-image';

/**
 * `POST /api/v1/qr/check` — answer one question of the form, where it is asked (ADR-121).
 *
 * Everything used to be checked when the whole form was sent. A member filled in eight
 * screens at a reception desk, pressed the button, and only then learnt that the gym
 * already had them — with a queue behind and nothing to do but start again. The owner
 * put it plainly: check each thing in its own place.
 *
 * **Nothing here writes anything.** It reads, answers, and forgets; the submission is
 * still the only thing that creates a member, and it repeats every one of these checks,
 * because a check a browser can skip is not a guard.
 *
 * **It says as little as it can.** A number or a date that belongs to somebody is
 * answered with *that it does*, never with whose — that would turn the form into a way
 * of asking "is this person a member here". The face is the one exception: a face is
 * proof of who is standing there, so the member is shown their own record and can stop
 * guessing why they are being turned away.
 *
 * It is rate-limited harder than the form it serves, for the same reason.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  const limit = qrCheckLimiters.byIp.hit(limiterKey('qr-check-ip', clientIp(request.headers)));
  if (!limit.allowed) {
    return apiError(429, 'RATE_LIMITED', 'Too many requests', requestId, {
      details: { retryAfterSeconds: limit.retryAfterSeconds },
      headers: { 'Retry-After': String(limit.retryAfterSeconds) },
    });
  }

  const form = await request.formData().catch(() => null);
  if (form === null) return apiError(400, 'VALIDATION_FAILED', 'Request body must be multipart form data', requestId);

  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' && value.length > 0 && value.length <= 1_000 ? value : null;
  };

  const container = getContainer();
  const gym = await loadGym(container);
  const settings = GymSettingsSchema.parse(gym.settings).attendance;
  const step = text('step');

  if (step === 'mobile') return checkMobile(container, gym.id, text('mobile'), text('journey'), requestId);
  if (step === 'dob') return checkDob(container, gym.id, text('dob'), requestId);
  if (step === 'selfie') return checkSelfie(form.get('selfie'), gym.id, settings, text('fullName'), requestId);
  if (step === 'govId') return checkGovId(form.get('govIdFront'), text('govIdType'), text('fullName'), text('dob'), requestId);

  return apiError(400, 'VALIDATION_FAILED', 'Unknown step', requestId);
}

/**
 * Is this number already somebody's?
 *
 * A member imported from the paper register is the one case that passes on the
 * existing-member journey, because turning their paper entry into a real record is
 * exactly what that form is for. Anybody else on the number is already in the register,
 * and a second record for them is the thing being prevented.
 */
async function checkMobile(
  container: ReturnType<typeof getContainer>,
  gymId: string,
  raw: string | null,
  journey: string | null,
  requestId: string,
) {
  const mobile = normaliseIndianMobile(raw ?? '');
  // Not a number yet. The form's own validation says so; this has nothing to add.
  if (mobile === null) return apiData({ ok: true as const }, requestId);

  const found = await container.prisma.member.findFirst({
    where: { gymId, mobile, deletedAt: null, status: { notIn: ['LEFT', 'BLOCKED'] } },
    select: { source: true, memberships: { where: { status: 'CONFIRMED' }, select: { id: true }, take: 1 } },
    orderBy: { createdAt: 'asc' },
  });
  if (found === null) return apiData({ ok: true as const }, requestId);

  /**
   * The one case that passes: a paper-register entry that has not been finished yet.
   *
   * Turning one of those into a real record is the entire purpose of the existing-member
   * form, so blocking it would mean nobody could ever use the form. **But only until it
   * is done.** `source` stays `IMPORT` for ever, so without the membership test the same
   * member could fill the form in every day — no duplicate member, because that is caught
   * elsewhere, but a fresh request in the verify queue each time for staff to wade
   * through. Once they hold a confirmed membership they are properly in the register and
   * there is nothing left for this form to do for them.
   */
  const unfinishedPaperEntry = found.source === 'IMPORT' && found.memberships.length === 0;
  if (journey === 'existing' && unfinishedPaperEntry) return apiData({ ok: true as const }, requestId);

  // Never who. "Is this number a member here" must not be a question the form answers.
  return apiData({ ok: false as const, reason: 'MOBILE_IN_USE' as const }, requestId);
}

/**
 * Somebody already has this date of birth.
 *
 * Which is unremarkable — a gym of two hundred has birthdays in common — so this is a
 * question and not a refusal. The screen says so and lets the member carry on, which is
 * what the owner asked for: "kai logo ke same DOB hota hai".
 */
async function checkDob(container: ReturnType<typeof getContainer>, gymId: string, raw: string | null, requestId: string) {
  if (raw === null || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return apiData({ ok: true as const }, requestId);

  const found = await container.prisma.member.count({
    where: { gymId, dob: new Date(`${raw}T00:00:00.000Z`), deletedAt: null, status: { notIn: ['LEFT', 'BLOCKED'] } },
  });
  return found === 0
    ? apiData({ ok: true as const }, requestId)
    : apiData({ ok: false as const, reason: 'DOB_IN_USE' as const, soft: true }, requestId);
}

/**
 * The photograph, measured and then compared against everybody enrolled.
 *
 * Both questions belong here: will this picture recognise them at the door, and is it
 * already somebody's face. The second is the only check that names a member — a face is
 * proof of who is holding the phone, so telling them their own record is not telling
 * them anything they do not know, and it ends the guessing.
 */
async function checkSelfie(
  file: FormDataEntryValue | null,
  gymId: string,
  attendance: Parameters<typeof checkSelfieFace>[1],
  fullName: string | null,
  requestId: string,
) {
  if (!(file instanceof Blob) || file.size === 0) return apiData({ ok: true as const }, requestId);
  if (file.size > MAX_SELFIE_BYTES) return apiData({ ok: false as const, reason: 'too_large' as const }, requestId);

  let selfie;
  try {
    selfie = await processSelfie(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return apiData({ ok: false as const, reason: 'unreadable' as const }, requestId);
  }

  const verdict = await checkSelfieFace(selfie.body, attendance);
  if (!verdict.ok) return apiData({ ok: false as const, reason: verdict.reason }, requestId);

  const twin = await alreadyAMember(verdict, gymId, attendance, fullName === null ? undefined : { fullName });
  return twin === null
    ? apiData({ ok: true as const }, requestId)
    : apiData({ ok: false as const, reason: 'ALREADY_A_MEMBER' as const, member: { fullName: twin.fullName } }, requestId);
}

/** The front of the card, read and judged (ADR-120). */
async function checkGovId(
  file: FormDataEntryValue | null,
  type: string | null,
  fullName: string | null,
  dob: string | null,
  requestId: string,
) {
  if (!(file instanceof Blob) || file.size === 0 || !isGovIdType(type) || fullName === null || dob === null) {
    return apiData({ ok: true as const }, requestId);
  }

  const verdict = await checkGovIdPhoto(type, new Uint8Array(await file.arrayBuffer()), { fullName, dob });
  return verdict.ok ? apiData({ ok: true as const }, requestId) : apiData({ ok: false as const, reason: verdict.reason }, requestId);
}
