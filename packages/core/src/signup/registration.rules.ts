import { compareISTDates, type ISTDate } from '@mfp/shared';
import { DomainError } from '../errors';
import { ageOn } from '../membership/dates';

/**
 * Registration rules (PRD SU-05, SU-07; BR-12).
 *
 * Pure decisions about a person signing up online: whether they are old enough,
 * whether they count as a minor, and which consent rows to record. The API route
 * validates the shape with the shared schema; this decides what it means.
 */

/** Anyone older is almost certainly a date typed wrongly (signup-and-payment-flow.md §3). */
export const MAX_REGISTRATION_AGE = 90;

const ADULT_AGE = 18;

export interface AgeAssessment {
  readonly age: number;
  /** BR-12.2: under 18 — face attendance stays off until a guardian consents at the desk. */
  readonly isMinor: boolean;
}

export function assessAge(input: { dob: ISTDate; today: ISTDate; minAge: number }): AgeAssessment {
  if (compareISTDates(input.dob, input.today) > 0) {
    throw new DomainError('VALIDATION_FAILED', 'Date of birth is in the future');
  }

  const age = ageOn(input.dob, input.today);
  if (age > MAX_REGISTRATION_AGE) {
    throw new DomainError('VALIDATION_FAILED', `Date of birth gives an age above ${MAX_REGISTRATION_AGE}`);
  }
  if (age < input.minAge) {
    throw new DomainError('UNDER_MINIMUM_AGE', `Members must be at least ${input.minAge} years old`, {
      minAge: input.minAge,
    });
  }
  return { age, isMinor: age < ADULT_AGE };
}

export type RegistrationConsentType = 'TERMS' | 'PRIVACY' | 'WHATSAPP_UPDATES' | 'FACE_ATTENDANCE';

export interface RegistrationConsentChoices {
  readonly terms: true;
  readonly privacy: true;
  readonly whatsappUpdates: boolean;
  readonly faceAttendance: boolean;
}

export interface RegistrationConsents {
  /** One row per choice, granted or not — a refusal is evidence too (privacy plan §4). */
  readonly rows: ReadonlyArray<{ readonly type: RegistrationConsentType; readonly granted: boolean }>;
  readonly whatsappOptIn: boolean;
  readonly faceConsent: boolean;
}

export function registrationConsents(input: {
  consents: RegistrationConsentChoices;
  isMinor: boolean;
}): RegistrationConsents {
  // A minor's own tick is not enough for biometric processing (BR-12.2).
  const faceConsent = input.consents.faceAttendance && !input.isMinor;
  return {
    rows: [
      { type: 'TERMS', granted: input.consents.terms },
      { type: 'PRIVACY', granted: input.consents.privacy },
      { type: 'WHATSAPP_UPDATES', granted: input.consents.whatsappUpdates },
      { type: 'FACE_ATTENDANCE', granted: faceConsent },
    ],
    whatsappOptIn: input.consents.whatsappUpdates,
    faceConsent,
  };
}
