import { findDuplicateFace } from '@mfp/core';
import type { AttendanceSettings, E164Mobile } from '@mfp/shared';
import { getContainer } from '@/lib/container';
import { faceGallery } from '@/lib/face-gallery';
import type { SelfieFaceVerdict } from '@/lib/selfie-face-gate';

/**
 * Is this face already a member, under some other name? (ADR-118)
 *
 * The owner signed up twice with their own face — once as "Kunal Mishra" on one number,
 * once as "Indresh Mishra" on another — and the gym took both. The names differed, the
 * numbers differed, and nothing else was checked.
 *
 * It runs on the embedding the selfie gate has already computed, so it costs a gallery
 * read and no second trip through the engine. It is silent whenever it cannot be sure:
 * no engine, no embedding, nobody enrolled, or a score below the gym's duplicate
 * threshold. A sign-up refused by mistake is worse than a duplicate the desk can merge.
 */
export async function alreadyAMember(
  verdict: SelfieFaceVerdict,
  gymId: string,
  attendance: AttendanceSettings,
  options: { readonly exceptMemberId?: string } = {},
): Promise<{ readonly memberId: string; readonly fullName: string; readonly mobile: E164Mobile } | null> {
  if (!verdict.ok || verdict.embedding === null || verdict.modelVersion === null) return null;

  const { gallery } = await faceGallery(gymId, verdict.modelVersion);
  if (gallery.length === 0) return null;

  const hit = findDuplicateFace(verdict.embedding, gallery, {
    duplicateThreshold: attendance.duplicateThreshold,
    ...(options.exceptMemberId === undefined ? {} : { exceptMemberId: options.exceptMemberId }),
  });
  if (hit === null) return null;

  // The name and number are for the desk, not for the member: the screen must not tell
  // somebody who else is on this face.
  const member = await getContainer().prisma.member.findFirst({
    where: { id: hit.memberId, gymId, deletedAt: null },
    select: { id: true, fullName: true, mobile: true },
  });
  return member === null ? null : { memberId: member.id, fullName: member.fullName, mobile: member.mobile as E164Mobile };
}
