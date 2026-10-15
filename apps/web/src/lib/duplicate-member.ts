import { findDuplicateFace } from '@mfp/core';
import type { AttendanceSettings, E164Mobile } from '@mfp/shared';
import { getContainer } from '@/lib/container';
import { faceGallery } from '@/lib/face-gallery';
import type { SelfieFaceVerdict } from '@/lib/selfie-face-gate';

/**
 * Is this face already a member, as somebody else? (ADR-118)
 *
 * The owner signed up twice with their own face — once as "Kunal Mishra", once as
 * "Indresh Mishra" — and the gym took both. The names differed, the numbers differed,
 * and nothing else was checked.
 *
 * **The face says who this is; the name says who they claim to be.** When those two
 * disagree, it is a second record for one person. The first attempt at this keyed on the
 * *number* instead, and the owner walked straight through it by registering a new name on
 * their existing number: same face, same mobile, different person as far as the register
 * was concerned. The number was never the identity.
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

/** The same normalisation the register match uses: case, padding and runs of spaces. */
const personName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

export async function alreadyAMember(
  verdict: SelfieFaceVerdict,
  gymId: string,
  attendance: AttendanceSettings,
  /**
   * Who this submission says it is. Given a name, a face matching **that** person is the
   * expected case at the reception QR and not a duplicate; omit it and any match counts,
   * which is what a brand-new sign-up means.
   */
  claiming?: { readonly fullName: string },
): Promise<MatchedMember | null> {
  if (!verdict.ok || verdict.embedding === null || verdict.modelVersion === null) return null;

  const { gallery } = await faceGallery(gymId, verdict.modelVersion);
  if (gallery.length === 0) return null;

  const hit = findDuplicateFace(verdict.embedding, gallery, { duplicateThreshold: attendance.duplicateThreshold });
  if (hit === null) return null;

  const member = await getContainer().prisma.member.findFirst({
    where: { id: hit.memberId, gymId, deletedAt: null },
    select: { id: true, fullName: true, mobile: true },
  });
  if (member === null) return null;

  // Matching yourself is the whole point of the existing-member form.
  if (claiming !== undefined && personName(member.fullName) === personName(claiming.fullName)) return null;

  // The name and number are for the desk and the log, never for the screen: telling a
  // stranger whose face they matched would hand them another member's identity.
  return { memberId: member.id, fullName: member.fullName, mobile: member.mobile as E164Mobile };
}
