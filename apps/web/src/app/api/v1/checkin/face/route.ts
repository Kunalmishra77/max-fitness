import type { NextRequest } from 'next/server';
import { assessCheckInFrame, matchFace, photoGatesFrom, selfCheckIn } from '@mfp/core';
import { GymSettingsSchema, todayIST } from '@mfp/shared';
import { PrismaCheckIn } from '@mfp/db';
import { FaceEngineUnavailableError } from '@mfp/integrations/face';
import { apiData, apiError, newRequestId } from '@/lib/api';
import { getContainer } from '@/lib/container';
import { faceGallery } from '@/lib/face-gallery';
import { kioskCaller } from '@/lib/kiosk-auth';

/**
 * `POST /api/v1/checkin/face` — one frame from the reception camera (ADR-107).
 *
 * The whole check-in in a single round trip: measure the face, decide whether the frame is
 * usable, find whose it is, and mark them in. A member is standing at the desk, so every
 * extra request is time they spend looking at a phone — and the screen sends a frame about
 * once a second until something is decided, so this has to be fast enough to keep up.
 *
 * **Nothing about the frame is kept.** It goes to the gym's own engine on the gym's own
 * private network, becomes 128 numbers, and is gone when the response is written. The
 * embedding is not stored either: this is recognition, not enrolment.
 *
 * Every refusal says *why* in a word the screen can turn into something a member can act
 * on. "Come closer" is useful; "not recognised" to somebody standing two feet away is not.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The screen downscales before posting; anything larger is a mistake or an attack. */
const MAX_FRAME_BYTES = 2 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const caller = await kioskCaller(request);
  if (caller === null) return apiError(401, 'UNAUTHENTICATED', 'This tablet is not paired', requestId);

  const container = getContainer();
  if (!container.face.configured) {
    // No engine configured at all: the screen falls back to the keypad and says so, rather
    // than leaving a member tapping at a camera that was never going to work.
    return apiData({ decision: 'UNAVAILABLE' as const }, requestId);
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('frame');
  if (!(file instanceof Blob)) return apiError(400, 'VALIDATION_FAILED', 'A frame is required', requestId);
  if (file.size === 0 || file.size > MAX_FRAME_BYTES) return apiError(413, 'PAYLOAD_TOO_LARGE', 'Frame too large', requestId);

  const gym = await container.prisma.gym.findUniqueOrThrow({ where: { id: caller.gymId }, select: { settings: true } });
  const settings = GymSettingsSchema.parse(gym.settings);
  const gates = photoGatesFrom(settings.attendance);

  let measured;
  try {
    measured = await container.face.embed(file, 'frame.jpg');
  } catch (error) {
    if (error instanceof FaceEngineUnavailableError) {
      // The engine, not the member. The screen says "use your number instead" rather than
      // anything about the member's face.
      console.warn(`[checkin-face] engine unavailable ${requestId}`);
      return apiData({ decision: 'UNAVAILABLE' as const }, requestId);
    }
    throw error;
  }

  // Cheap checks before the gallery is touched: a frame of the ceiling, or of two people,
  // has nothing to match and the screen can say so immediately.
  const usable = assessCheckInFrame(measured.measurement, gates);
  if (!usable.ok) {
    return apiData({ decision: 'NO_MATCH' as const, reason: usable.reason }, requestId);
  }

  const { gallery, enrolledMembers } = await faceGallery(caller.gymId, measured.modelVersion);
  if (gallery.length === 0) {
    // Nobody is enrolled yet. Distinct from "we do not recognise you", because the fix is
    // the gym's and not the member's.
    return apiData({ decision: 'NOBODY_ENROLLED' as const }, requestId);
  }

  const match = matchFace(measured.embedding ?? [], gallery, {
    acceptThreshold: settings.attendance.acceptThreshold,
    confirmBand: settings.attendance.confirmBand,
    matchMargin: settings.attendance.matchMargin,
    framesToAgree: settings.attendance.framesToAgree,
  });

  if (match.decision === 'UNKNOWN' || match.memberId === null) {
    return apiData({ decision: 'NO_MATCH' as const, reason: 'UNKNOWN' as const }, requestId);
  }

  // Good, but not clearly better than the runner-up: the screen asks rather than greets.
  // Greeting the wrong member marks the wrong attendance in front of both of them, while
  // asking costs one tap.
  if (match.decision === 'CONFIRM') {
    const member = await container.prisma.member.findFirst({
      where: { id: match.memberId, gymId: caller.gymId, deletedAt: null },
      select: { id: true, fullName: true },
    });
    if (member === null) return apiData({ decision: 'NO_MATCH' as const, reason: 'UNKNOWN' as const }, requestId);
    return apiData({ decision: 'CONFIRM' as const, memberId: member.id, memberName: member.fullName, score: match.score }, requestId);
  }

  const today = todayIST(container.clock);
  const result = await selfCheckIn(
    {
      gymId: caller.gymId,
      memberId: match.memberId,
      // The event's own identity, so a frame that arrives twice — a retry, a double tap —
      // marks one visit. The member and the minute are what make it the same event.
      clientEventId: `face:${match.memberId}:${today}:${Math.floor(container.clock.now().getTime() / 60_000)}`,
      method: 'FACE',
    },
    {
      clock: container.clock,
      cooldownMinutes: settings.attendance.checkInCooldownMinutes,
      // The tablet's own flag, not the gym's: one phone may still be being trusted while
      // another is already greeting members by name.
      shadowMode: caller.shadowMode,
      uow: new PrismaCheckIn(container.prisma).unitOfWork(today),
    },
  );

  if (result.decision === 'NOT_FOUND') return apiData({ decision: 'NO_MATCH' as const, reason: 'UNKNOWN' as const }, requestId);

  return apiData(
    {
      decision: result.decision,
      memberName: result.memberName,
      greeting: result.greeting,
      score: match.score,
      enrolledMembers,
    },
    requestId,
    result.decision === 'RECORD' ? 201 : 200,
  );
}
