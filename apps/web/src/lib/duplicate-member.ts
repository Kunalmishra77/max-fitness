import { claimedMemberId, findDuplicateFace } from '@mfp/core';
import type { AttendanceSettings, E164Mobile } from '@mfp/shared';
import { getContainer } from '@/lib/container';
import { faceGallery } from '@/lib/face-gallery';
import type { SelfieFaceVerdict } from '@/lib/selfie-face-gate';

/**
 * Is this face already a member, as somebody else? (ADR-118, ADR-124)
 *
 * The owner signed up twice with their own face — under one name, then under a
 * different one — and the gym took both. The names differed, the numbers differed,
 * and nothing else was checked.
 *
 * **The face says who this is; the record says who they claim to be.** When those two
 * disagree, it is a second record for one person.
 *
 * Which record they claim is the part that has been wrong twice. Keyed on the *number*,
 * the owner walked through by registering a new name on their existing number. Keyed on
 * the *name*, they walked through again under a name the register held on a number the gym had
 * never seen, and the register ended up holding MF-0001 and MF-0014, both of them him.
 * `claimedMemberId` is where that judgement now lives, and where it is tested.
 *
 * It runs on the embedding the selfie gate has already computed, so it costs a gallery
 * read and no second trip through the engine. It is silent whenever it cannot be sure —
 * no engine, no embedding, nobody enrolled, or a score below the gym's threshold —
 * because a sign-up refused by mistake is worse than a duplicate the desk can merge.
 */

export interface MatchedMember {
  readonly memberId: string;
  readonly fullName: string;
  readonly mobile: E164Mobile;
}

export async function alreadyAMember(
  verdict: SelfieFaceVerdict,
  gymId: string,
  attendance: AttendanceSettings,
  /**
   * The record this submission says it is finishing — the name *and* the number
   * together, because either alone is something a stranger can supply. Omit it and any
   * match in the register counts, which is what a brand-new sign-up means.
   */
  claiming?: { readonly fullName: string; readonly mobile: E164Mobile },
): Promise<MatchedMember | null> {
  if (!verdict.ok || verdict.embedding === null || verdict.modelVersion === null) return null;

  const { prisma } = getContainer();
  const { gallery } = await faceGallery(gymId, verdict.modelVersion);
  if (gallery.length === 0) return null;

  /**
   * Everyone holding the number given. Almost always nobody or one — a family sharing a
   * handset is the reason it is not assumed to be one — and only the one carrying the
   * claimed name is excused.
   */
  const onThatNumber =
    claiming === undefined
      ? []
      : await prisma.member.findMany({
          where: { gymId, mobile: claiming.mobile, deletedAt: null },
          select: { id: true, fullName: true },
          orderBy: { createdAt: 'asc' },
        });
  const self = claimedMemberId(claiming, onThatNumber);

  const hit = findDuplicateFace(verdict.embedding, gallery, {
    duplicateThreshold: attendance.duplicateThreshold,
    ...(self === undefined ? {} : { exceptMemberId: self }),
  });
  if (hit === null) return null;

  const member = await prisma.member.findFirst({
    where: { id: hit.memberId, gymId, deletedAt: null },
    select: { id: true, fullName: true, mobile: true },
  });
  if (member === null) return null;

  // The name and number are for the desk and the log, never for the screen: telling a
  // stranger whose face they matched would hand them another member's identity.
  return { memberId: member.id, fullName: member.fullName, mobile: member.mobile as E164Mobile };
}
