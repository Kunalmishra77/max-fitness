import { describe, expect, it } from 'vitest';
import { DEFAULT_PHOTO_GATES } from './photo-quality';
import { decideEnrolment, type EnrolmentCandidate } from './enrolment';

/**
 * Whether a member's photograph becomes a face template (ADR-107; privacy plan §4).
 *
 * Two different questions, and both have to be yes. *May* we hold this member's face —
 * consent, age, status — and *can* this photograph recognise them later. Confusing the two
 * is how a system ends up either storing a face it was not allowed to, or enrolling a
 * member off a photograph that will never match them at the desk.
 */

const candidate = (over: Partial<EnrolmentCandidate> = {}): EnrolmentCandidate => ({
  faceConsent: true,
  isMinor: false,
  memberStatus: 'ACTIVE',
  existingTemplates: 0,
  maxTemplatesPerMember: 8,
  measurement: {
    found: true,
    facePx: 284,
    confidence: 0.93,
    brightness: 125,
    alignedSharpness: 1849,
    facesInFrame: 1,
    secondFacePx: 0,
  },
  ...over,
});

describe('decideEnrolment — may we hold this face', () => {
  it('enrols a consenting adult member from a good photograph', () => {
    expect(decideEnrolment(candidate(), DEFAULT_PHOTO_GATES)).toEqual({ enrol: true });
  });

  it('refuses a member who did not consent to face attendance', () => {
    // Three of the gym's fifteen members ticked no. Their photograph is still their
    // photograph; it just never becomes a template.
    expect(decideEnrolment(candidate({ faceConsent: false }), DEFAULT_PHOTO_GATES)).toEqual({
      enrol: false,
      reason: 'NO_CONSENT',
    });
  });

  it('refuses a minor, whatever the form said', () => {
    // BR-12: a child cannot give this consent, and a parent ticking a box on a phone at the
    // desk is not the same thing. The gym marks them manually.
    expect(decideEnrolment(candidate({ isMinor: true }), DEFAULT_PHOTO_GATES)).toEqual({
      enrol: false,
      reason: 'MINOR',
    });
  });

  it('refuses a member who has left', () => {
    expect(decideEnrolment(candidate({ memberStatus: 'LEFT' }), DEFAULT_PHOTO_GATES)).toEqual({
      enrol: false,
      reason: 'NOT_A_MEMBER',
    });
  });

  it('enrols somebody who has signed up but not yet paid', () => {
    // Every member in the register today is PENDING_PAYMENT. Waiting for payment before
    // enrolling would mean nobody could be recognised on the day they join — and the
    // greeting already tells them their fees are due, which is the point.
    expect(decideEnrolment(candidate({ memberStatus: 'PENDING_PAYMENT' }), DEFAULT_PHOTO_GATES)).toEqual({ enrol: true });
  });

  it('refuses once the member has as many templates as the gym allows', () => {
    expect(decideEnrolment(candidate({ existingTemplates: 8, maxTemplatesPerMember: 8 }), DEFAULT_PHOTO_GATES)).toEqual({
      enrol: false,
      reason: 'ENOUGH_TEMPLATES',
    });
  });
});

describe('decideEnrolment — can this photograph recognise them later', () => {
  it('refuses a selfie taken from too far away, with the reason the member can act on', () => {
    // The whole feature rests on this: 129px measured 0.42 against itself under camera
    // conditions, which is below where two different members score.
    expect(decideEnrolment(candidate({ measurement: { ...candidate().measurement, facePx: 129 } as never }), DEFAULT_PHOTO_GATES)).toEqual({
      enrol: false,
      reason: 'TOO_FAR',
    });
  });

  it('refuses a photograph with no face in it — an animal, a product, a wall', () => {
    expect(decideEnrolment(candidate({ measurement: { found: false } }), DEFAULT_PHOTO_GATES)).toEqual({
      enrol: false,
      reason: 'NO_FACE',
    });
  });

  it('refuses a photograph with somebody else standing in it', () => {
    expect(
      decideEnrolment(
        candidate({ measurement: { ...candidate().measurement, facesInFrame: 2, secondFacePx: 200 } as never }),
        DEFAULT_PHOTO_GATES,
      ),
    ).toEqual({ enrol: false, reason: 'ANOTHER_FACE' });
  });

  it('checks permission before quality, so a member who may not be enrolled is never told to move closer', () => {
    // Telling somebody who ticked "no" to step nearer the camera would be asking them to
    // fix a photograph that was never going to be used.
    expect(
      decideEnrolment(
        candidate({ faceConsent: false, measurement: { ...candidate().measurement, facePx: 40 } as never }),
        DEFAULT_PHOTO_GATES,
      ),
    ).toEqual({ enrol: false, reason: 'NO_CONSENT' });
  });
});
