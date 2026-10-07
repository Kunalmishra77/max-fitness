import { decideEnrolment, photoGatesFrom } from '@mfp/core';
import { PrismaFaceTemplates, keyFromEnv } from '@mfp/db';
import type { AttendanceSettings } from '@mfp/shared';
import { getContainer } from '@/lib/container';
import { forgetFaceGallery } from '@/lib/face-gallery';
import type { SelfieFaceVerdict } from '@/lib/selfie-face-gate';

/**
 * Enrol a member the moment they sign up (ADR-107).
 *
 * The selfie gate has already measured the photograph and computed the embedding, so this
 * writes the template from what is already in hand — no second trip through the engine for
 * a face it looked at a moment ago.
 *
 * **Nothing here may fail a sign-up.** A member who has filled in a form, taken a selfie and
 * pressed the button is registered; whether the gym can recognise their face is a smaller
 * matter than whether they are a member at all. Every failure is swallowed, logged without
 * anything about the person, and left for `enrol:faces` to pick up.
 */
export async function enrolFromSignup(
  registration: { readonly memberId: string; readonly isMinor: boolean },
  verdict: SelfieFaceVerdict,
  gymId: string,
  attendance: AttendanceSettings,
): Promise<void> {
  // Either the engine was not reachable, or the photograph was refused — and a refusal has
  // already been answered to the member, so there is nothing to enrol from.
  if (!verdict.ok || verdict.embedding === null || verdict.modelVersion === null) return;

  try {
    const { prisma, env } = getContainer();
    const member = await prisma.member.findUnique({
      where: { id: registration.memberId },
      select: { faceConsent: true, isMinor: true, status: true },
    });
    if (member === null) return;

    // The photograph already passed the gate, so this run of the rules is about permission:
    // consent, age, status. Those are read back from the row the registration just wrote
    // rather than from the form, because the row is what the gym will be held to.
    const decision = decideEnrolment(
      {
        faceConsent: member.faceConsent,
        isMinor: member.isMinor,
        memberStatus: member.status,
        existingTemplates: 0,
        maxTemplatesPerMember: attendance.maxTemplatesPerMember,
        measurement: { found: true, facePx: verdict.facePx ?? 0, confidence: 1, brightness: 128, alignedSharpness: 1000, facesInFrame: 1, secondFacePx: 0 },
      },
      photoGatesFrom(attendance),
    );
    if (!decision.enrol) return;

    await new PrismaFaceTemplates(prisma, keyFromEnv(env.FIELD_ENCRYPTION_KEY)).save({
      gymId,
      memberId: registration.memberId,
      vector: verdict.embedding,
      modelVersion: verdict.modelVersion,
      // The face's size is the quality that mattered; keeping it answers "who was enrolled
      // off a poor photograph" later, without keeping the photograph to find out.
      qualityScore: verdict.facePx ?? 0,
      sourceKind: 'signup_selfie',
    });
    // So the next frame at the desk can already see them: a member who joins at 6am and
    // trains at 6.05 should not have to use the keypad.
    forgetFaceGallery(gymId);
  } catch {
    // Never anything about the member in this line. Their face is not an error message.
    console.warn('[enrol-on-signup] could not enrol this member; the backfill script will');
  }
}
