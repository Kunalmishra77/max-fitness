/**
 * Whether a photograph can be trusted — at signup, and at the desk (ADR-107).
 *
 * The owner asked for two things in one breath: *only approve a selfie that will actually
 * mark attendance later*, and *refuse anything that is not the member* — a product, an
 * animal, a photograph of a wall. Both are answered here, because they are the same
 * question asked of the same measurements.
 *
 * **The numbers are measured, not chosen.** Running the engine over the gym's own fifteen
 * selfies and degrading each one the way a reception camera degrades a face: every member
 * whose enrolment photograph held a face of **192 px or more** scored 0.84–0.99 against
 * themselves, while the two at **43 px** and **129 px** fell to 0.59 and 0.42 — *below* the
 * 0.387 at which two different members scored against each other. There is no threshold
 * further down the pipeline that can rescue a selfie taken from too far away, which is why
 * this gate matters more than any of them.
 *
 * Pure, and free of any engine: it reads measurements, not pixels.
 */

/** What `apps/face` reports back. A frame with no face carries nothing else. */
export type FaceMeasurement =
  | {
      readonly found: true;
      /** Shorter side of the face box, in pixels of the image as sent. The decisive one. */
      readonly facePx: number;
      /** 0–1, the detector's own. The gym's real selfies ranged 0.79–0.95. */
      readonly confidence: number;
      /** Mean luminance of the face, 0–255. */
      readonly brightness: number;
      /** Laplacian variance of the aligned 112×112 face — the view the recogniser gets. */
      readonly alignedSharpness: number;
      readonly facesInFrame: number;
      /** Shorter side of the second biggest face, or 0. */
      readonly secondFacePx: number;
    }
  | { readonly found: false; readonly notAnImage?: boolean };

export type PhotoRejection =
  | 'NOT_AN_IMAGE'
  | 'NO_FACE'
  | 'NOT_A_FACE'
  | 'TOO_FAR'
  | 'TOO_DARK'
  | 'TOO_BRIGHT'
  | 'BLURRED'
  | 'ANOTHER_FACE';

export type PhotoVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: PhotoRejection };

export interface PhotoGates {
  /**
   * The gate that decides whether face attendance works at all.
   *
   * 180 sits above the 129 px selfie that failed and below the 192 px one that worked
   * perfectly, with room on both sides.
   */
  readonly enrolmentMinFacePx: number;
  /**
   * Deliberately much lower.
   *
   * A well-enrolled member scored 0.98 median at a third of their enrolment size, so the
   * desk does not need a big face — demanding one would have members leaning into the
   * phone. What the desk does need is *some* face, rather than a head in the distance.
   */
  readonly checkInMinFacePx: number;
  readonly minConfidence: number;
  readonly minBrightness: number;
  readonly maxBrightness: number;
  /**
   * A floor, not a ranking.
   *
   * Sharpness was measured across the gym's selfies and does **not** separate good
   * enrolments from bad: the two photographs that failed recognition scored 236 and 858,
   * while a member who recognised perfectly scored 130. Used as a quality score it would
   * reject the wrong people, so it is set below every real selfie and only catches an
   * image that is genuinely smeared.
   */
  readonly minAlignedSharpness: number;
  /**
   * How big a second face has to be, relative to the main one, to count as another person.
   *
   * Two of the gym's own selfies contain a second detection a few pixels across — a pattern
   * on a wall, a reflection. Counting faces would have refused real members because of
   * their wallpaper; comparing them refuses only somebody actually standing there.
   */
  readonly secondFaceRatio: number;
}

export const DEFAULT_PHOTO_GATES: PhotoGates = {
  enrolmentMinFacePx: 180,
  checkInMinFacePx: 60,
  minConfidence: 0.7,
  minBrightness: 45,
  maxBrightness: 225,
  minAlignedSharpness: 60,
  secondFaceRatio: 0.45,
};

const no = (reason: PhotoRejection): PhotoVerdict => ({ ok: false, reason });
const YES: PhotoVerdict = { ok: true };

/**
 * The checks every photograph faces, in the order a person can act on.
 *
 * Distance first, because it is both the gate that matters most and the one whose fix —
 * step closer — usually fixes the lighting too. Only the first problem is reported: a
 * member handed a list of four faults does not know which one to try.
 */
function assess(measurement: FaceMeasurement, gates: PhotoGates, minFacePx: number): PhotoVerdict {
  if (!measurement.found) {
    return no(measurement.notAnImage === true ? 'NOT_AN_IMAGE' : 'NO_FACE');
  }
  // A detection the engine is barely willing to make is usually a pattern that happens to
  // resemble a face, not a face.
  if (measurement.confidence < gates.minConfidence) return no('NOT_A_FACE');
  if (measurement.facePx < minFacePx) return no('TOO_FAR');
  if (measurement.secondFacePx >= measurement.facePx * gates.secondFaceRatio) return no('ANOTHER_FACE');
  if (measurement.brightness < gates.minBrightness) return no('TOO_DARK');
  if (measurement.brightness > gates.maxBrightness) return no('TOO_BRIGHT');
  if (measurement.alignedSharpness < gates.minAlignedSharpness) return no('BLURRED');
  return YES;
}

/**
 * The signup selfie: the one photograph the member will be recognised against for as long
 * as they belong to the gym. Everything is strict here, because nothing downstream can
 * recover from it.
 */
export function assessEnrolmentPhoto(measurement: FaceMeasurement, gates: PhotoGates): PhotoVerdict {
  return assess(measurement, gates, gates.enrolmentMinFacePx);
}

/** A frame from the reception camera. Looser, for the reason `checkInMinFacePx` gives. */
export function assessCheckInFrame(measurement: FaceMeasurement, gates: PhotoGates): PhotoVerdict {
  return assess(measurement, gates, gates.checkInMinFacePx);
}
