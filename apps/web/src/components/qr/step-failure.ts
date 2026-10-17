import { SELFIE_REASONS } from './selfie-reasons';

/**
 * Turn a refusal from `/api/v1/qr/check` into a message that exists (MEM-003, MEM-004).
 *
 * Both QR forms used to render every per-step refusal as `stepCheck.${reason}`. Only three
 * of those keys were ever written — `MOBILE_IN_USE`, `DOB_IN_USE` and
 * `ALREADY_A_MEMBER_NAMED` — and the endpoint returns seventeen reasons. So since ADR-121
 * moved the checks to the step where each question is asked, a member whose selfie or ID
 * photograph was refused saw the **key itself** on the screen:
 * `qrExisting.stepCheck.NAME_MISMATCH`. At a reception desk, in Hindi, with a queue.
 *
 * The messages existed all along, in the two tables the *submission* path already used —
 * `errors.selfie*` for the photograph and `govIdReasons.*` for the card. This routes the
 * per-step refusal through the same tables, so there is one answer per reason rather than
 * two paths that can disagree.
 *
 * It also decides **where** the message goes, which is the half that makes it useful. A
 * refused photograph belongs beside the photograph, on the step holding it, so the member
 * can retake it; a page-level banner saying "name does not match" above a form they have
 * already left is not something anybody can act on.
 */

/** `GovIdTextProblem` in `packages/core/src/qr/gov-id-text.ts`. */
const GOV_ID_REASONS = new Set(['UNREADABLE', 'NOT_AN_ID', 'WRONG_TYPE', 'NAME_MISMATCH', 'DOB_MISMATCH']);

export interface StepFailure {
  /** Which field to attach the message to, or `null` for a page-level failure. */
  readonly field: 'selfie' | 'govId' | null;
  /** A key inside the `qrExisting` namespace, which both forms read. */
  readonly key: string;
}

export function stepFailure(reason: string): StepFailure {
  // The photograph: the gate's own codes plus the image processor's lower-case ones.
  const selfie = SELFIE_REASONS[reason];
  if (selfie !== undefined) return { field: 'selfie', key: `errors.${selfie}` };

  if (GOV_ID_REASONS.has(reason)) return { field: 'govId', key: `govIdReasons.${reason}` };

  /**
   * Anything else is about the member rather than about a file they uploaded — the number
   * already being somebody's, a face already in the register — and those are page-level,
   * because they are not fixed by retaking anything.
   */
  return { field: null, key: `stepCheck.${reason}` };
}
