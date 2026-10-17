/**
 * Which record an existing-member submission is about (ADR-124).
 *
 * The reception QR's existing-member form exists so somebody already in the paper
 * register can finish their own record, so their face matching that record is the form
 * working, not a duplicate. The question is which record counts as "their own", and it
 * has now been answered wrongly twice.
 *
 * **Keyed on the number alone**, the owner walked through by filling the form as a new
 * name on their own number: same face, same mobile, a second member.
 *
 * **Keyed on the name alone**, the owner walked through again by filling the form as
 * under a name the gym already held — on a number the gym had never seen.
 * Same face, and the register ended up with MF-0001 and MF-0014, both of them him.
 *
 * It is both or neither. A member finishing their paper entry gives the number the gym
 * wrote down and the name beside it; anybody giving one without the other is claiming a
 * record that is not theirs, and the face is then checked against the whole register.
 *
 * Two members may genuinely share a name — the owner was explicit that a gym has
 * Sharmas — so a name alone never identifies anybody here.
 */

export interface RegisterEntry {
  readonly id: string;
  readonly fullName: string;
}

/** Case, padding and runs of spaces, as the register match in the repository does. */
const personName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * @param claiming who the submission says it is, or `undefined` on the new-member
 *   journey, which claims no existing record and so is excused nothing.
 * @param onThatNumber every live member holding the number given, oldest first.
 */
export function claimedMemberId(
  claiming: { readonly fullName: string } | undefined,
  onThatNumber: readonly RegisterEntry[],
): string | undefined {
  if (claiming === undefined) return undefined;
  const wanted = personName(claiming.fullName);
  return onThatNumber.find((entry) => personName(entry.fullName) === wanted)?.id;
}
