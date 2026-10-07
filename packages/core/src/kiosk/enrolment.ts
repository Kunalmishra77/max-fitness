import { assessEnrolmentPhoto, type FaceMeasurement, type PhotoGates, type PhotoRejection } from './photo-quality';

/**
 * Whether a member's photograph becomes a face template (ADR-107; privacy plan §4; BR-12).
 *
 * Two separate questions, and both must be yes:
 *
 * 1. **May we hold this member's face at all** — did they consent, are they an adult, are
 *    they still a member, and do they already have as many templates as the gym keeps.
 * 2. **Can this photograph recognise them later** — the measured gate, which is the thing
 *    that decides whether face attendance works at all.
 *
 * Permission is checked first, deliberately. Telling somebody who ticked "no" to step
 * closer to the camera would be asking them to fix a photograph that was never going to be
 * used, and it would also reveal that the gym was going to use it.
 */

export type EnrolmentRefusal = 'NO_CONSENT' | 'MINOR' | 'NOT_A_MEMBER' | 'ENOUGH_TEMPLATES' | PhotoRejection;

export interface EnrolmentCandidate {
  readonly faceConsent: boolean;
  readonly isMinor: boolean;
  readonly memberStatus: string;
  readonly existingTemplates: number;
  readonly maxTemplatesPerMember: number;
  readonly measurement: FaceMeasurement;
}

export type EnrolmentDecision = { readonly enrol: true } | { readonly enrol: false; readonly reason: EnrolmentRefusal };

/**
 * Who can be enrolled at all.
 *
 * `PENDING_PAYMENT` is included on purpose. Every member in this register signed up before
 * paying, and waiting for the payment would mean nobody could be recognised on the day they
 * join — while the greeting a check-in gives them already says their fees are due, which is
 * exactly the conversation the gym wants to have.
 */
const ENROLLABLE_STATUSES: ReadonlySet<string> = new Set(['ACTIVE', 'PENDING_PAYMENT', 'PENDING_VERIFICATION']);

export function decideEnrolment(candidate: EnrolmentCandidate, gates: PhotoGates): EnrolmentDecision {
  if (!candidate.faceConsent) return { enrol: false, reason: 'NO_CONSENT' };
  // BR-12: a child cannot give this consent, and a parent ticking a box on a phone at the
  // desk is not the same thing. A minor's attendance is marked by hand.
  if (candidate.isMinor) return { enrol: false, reason: 'MINOR' };
  if (!ENROLLABLE_STATUSES.has(candidate.memberStatus)) return { enrol: false, reason: 'NOT_A_MEMBER' };
  if (candidate.existingTemplates >= candidate.maxTemplatesPerMember) return { enrol: false, reason: 'ENOUGH_TEMPLATES' };

  const photo = assessEnrolmentPhoto(candidate.measurement, gates);
  return photo.ok ? { enrol: true } : { enrol: false, reason: photo.reason };
}
