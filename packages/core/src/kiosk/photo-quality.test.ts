import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHOTO_GATES,
  assessCheckInFrame,
  assessEnrolmentPhoto,
  type FaceMeasurement,
  type PhotoGates,
} from './photo-quality';

/**
 * Whether a photograph can be trusted (ADR-107).
 *
 * The owner put the rule plainly: only approve a selfie that will actually recognise the
 * member later, and refuse anything that is not them — a product, an animal, a picture of
 * a wall. Both halves are the same question asked at the same moment, and the numbers
 * behind the first half are measured, not guessed.
 *
 * Measured on the gym's own fifteen selfies: every member whose face was 192px or more
 * survived every camera condition at 0.84–0.99, while the two at 43px and 129px fell to
 * 0.59 and 0.42 — below where *different people* score against each other (0.387). The
 * size gate is the one that decides whether any of this works.
 */

const real = (over: Partial<FaceMeasurement> = {}): FaceMeasurement => ({
  found: true,
  facePx: 284,
  confidence: 0.93,
  brightness: 125,
  alignedSharpness: 1849,
  facesInFrame: 1,
  secondFacePx: 0,
  ...over,
});

describe('assessEnrolmentPhoto', () => {
  it('accepts a selfie like the ones the gym already has', () => {
    expect(assessEnrolmentPhoto(real(), DEFAULT_PHOTO_GATES)).toEqual({ ok: true });
  });

  describe('things that are not the member', () => {
    it('refuses a photograph with no face in it — an animal, a product, a wall', () => {
      // YuNet is a human-face detector, so all of those arrive here the same way: nothing
      // was found. There is no member in the picture to recognise later.
      expect(assessEnrolmentPhoto({ found: false }, DEFAULT_PHOTO_GATES)).toEqual({ ok: false, reason: 'NO_FACE' });
    });

    it('refuses a file that is not an image at all', () => {
      expect(assessEnrolmentPhoto({ found: false, notAnImage: true }, DEFAULT_PHOTO_GATES)).toEqual({
        ok: false,
        reason: 'NOT_AN_IMAGE',
      });
    });

    it('refuses something the detector is barely willing to call a face', () => {
      // A weak detection is usually a pattern that happens to look like one. The gym's own
      // selfies never scored below 0.79.
      expect(assessEnrolmentPhoto(real({ confidence: 0.45 }), DEFAULT_PHOTO_GATES)).toEqual({
        ok: false,
        reason: 'NOT_A_FACE',
      });
    });
  });

  describe('a face that is there but cannot be used', () => {
    it('refuses a face too small to recognise the member by later', () => {
      // 129px is the real selfie that failed: it scored 0.42 against itself under camera
      // conditions, which is below what two different members score.
      expect(assessEnrolmentPhoto(real({ facePx: 129 }), DEFAULT_PHOTO_GATES)).toEqual({ ok: false, reason: 'TOO_FAR' });
      expect(assessEnrolmentPhoto(real({ facePx: 43 }), DEFAULT_PHOTO_GATES)).toEqual({ ok: false, reason: 'TOO_FAR' });
    });

    it('accepts the smallest face that actually worked', () => {
      // Shilpa Agrawal's selfie: 192px, and 0.962 at its worst across every condition.
      expect(assessEnrolmentPhoto(real({ facePx: 192 }), DEFAULT_PHOTO_GATES)).toEqual({ ok: true });
    });

    it('refuses a face too dark or too bright to hold any detail', () => {
      expect(assessEnrolmentPhoto(real({ brightness: 28 }), DEFAULT_PHOTO_GATES)).toEqual({ ok: false, reason: 'TOO_DARK' });
      expect(assessEnrolmentPhoto(real({ brightness: 240 }), DEFAULT_PHOTO_GATES)).toEqual({ ok: false, reason: 'TOO_BRIGHT' });
    });

    it('refuses a genuinely smeared photograph, but does not rank photographs by sharpness', () => {
      // Sharpness was measured and found not to separate good enrolments from bad: the two
      // that failed scored 236 and 858, while a member who recognised perfectly scored 130.
      // So the floor only catches a real smear, and 130 must still pass.
      expect(assessEnrolmentPhoto(real({ alignedSharpness: 12 }), DEFAULT_PHOTO_GATES)).toEqual({ ok: false, reason: 'BLURRED' });
      expect(assessEnrolmentPhoto(real({ alignedSharpness: 130 }), DEFAULT_PHOTO_GATES)).toEqual({ ok: true });
    });
  });

  describe('somebody else in the photograph', () => {
    it('refuses a second person standing in the shot', () => {
      expect(assessEnrolmentPhoto(real({ facesInFrame: 2, secondFacePx: 220 }), DEFAULT_PHOTO_GATES)).toEqual({
        ok: false,
        reason: 'ANOTHER_FACE',
      });
    });

    it('ignores a speck the detector called a face', () => {
      // Two of the gym's real selfies contain a second detection a few pixels across — a
      // pattern on a wall. Counting faces rather than comparing them would refuse a member
      // because of their wallpaper.
      expect(assessEnrolmentPhoto(real({ facePx: 310, facesInFrame: 2, secondFacePx: 18 }), DEFAULT_PHOTO_GATES)).toEqual({ ok: true });
    });
  });

  it('reports the first thing wrong, so the member is told one thing to fix', () => {
    // A photograph that is too far *and* too dark gets "come closer", not a list. Distance
    // is first because fixing it usually fixes the rest.
    expect(assessEnrolmentPhoto(real({ facePx: 60, brightness: 20 }), DEFAULT_PHOTO_GATES)).toEqual({ ok: false, reason: 'TOO_FAR' });
  });
});

describe('assessCheckInFrame', () => {
  it('lets a member be recognised from further away than they enrolled from', () => {
    // Deliberately looser. The enrolment photograph is the one that has to be good: a
    // well-enrolled member scored 0.98 median even at a third of the size. Demanding a
    // 180px face at the desk would leave members leaning into the phone.
    expect(assessCheckInFrame(real({ facePx: 90 }), DEFAULT_PHOTO_GATES)).toEqual({ ok: true });
  });

  it('still refuses a face too small to be the person standing at the desk', () => {
    expect(assessCheckInFrame(real({ facePx: 30 }), DEFAULT_PHOTO_GATES)).toEqual({ ok: false, reason: 'TOO_FAR' });
  });

  it('refuses a frame with two people in it rather than guessing which one is checking in', () => {
    expect(assessCheckInFrame(real({ facesInFrame: 2, secondFacePx: 150 }), DEFAULT_PHOTO_GATES)).toEqual({
      ok: false,
      reason: 'ANOTHER_FACE',
    });
  });

  it('says nothing is there when the camera is pointed at the ceiling', () => {
    expect(assessCheckInFrame({ found: false }, DEFAULT_PHOTO_GATES)).toEqual({ ok: false, reason: 'NO_FACE' });
  });
});

describe('the gates themselves', () => {
  it('sit where the measurements put them, not where a round number would', () => {
    expect(DEFAULT_PHOTO_GATES.enrolmentMinFacePx).toBe(180);
    expect(DEFAULT_PHOTO_GATES.checkInMinFacePx).toBe(60);
    expect(DEFAULT_PHOTO_GATES.minConfidence).toBe(0.7);
  });

  it('can be tightened per gym without touching the rules', () => {
    const strict: PhotoGates = { ...DEFAULT_PHOTO_GATES, enrolmentMinFacePx: 300 };
    expect(assessEnrolmentPhoto(real({ facePx: 250 }), strict)).toEqual({ ok: false, reason: 'TOO_FAR' });
  });
});
