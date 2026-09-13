/**
 * Selfie framing rules (signup-and-payment-flow.md §2.3–2.4), kept free of the camera
 * and the detector so they can be tested as plain arithmetic.
 */

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FrameSize {
  readonly width: number;
  readonly height: number;
}

export type FaceCheck = 'ok' | 'none' | 'multiple' | 'small' | 'offCentre';

/** §2.3: the face must be at least this share of the frame's width. */
const MIN_FACE_WIDTH_SHARE = 0.35;
/** How far the face centre may sit from the frame centre and still be "inside the oval". */
const MAX_OFFSET_X_SHARE = 0.15;
const MAX_OFFSET_Y_SHARE = 0.2;
/** §2.4: 40% padding on each side of the face box. */
const CROP_PADDING = 0.4;

/** §2.3: a passing face must hold this long before "Take photo" is enabled. */
export const FACE_STEADY_MS = 500;

export function faceCheck(faces: readonly Box[], frame: FrameSize): FaceCheck {
  if (faces.length === 0) return 'none';
  if (faces.length > 1) return 'multiple';
  const [face] = faces as [Box];

  if (face.width < frame.width * MIN_FACE_WIDTH_SHARE) return 'small';

  const offsetX = Math.abs(face.x + face.width / 2 - frame.width / 2);
  const offsetY = Math.abs(face.y + face.height / 2 - frame.height / 2);
  if (offsetX > frame.width * MAX_OFFSET_X_SHARE || offsetY > frame.height * MAX_OFFSET_Y_SHARE) return 'offCentre';

  return 'ok';
}

/** The square of the frame to keep: around the face when known, else the centre. */
export function squareCrop(frame: FrameSize, face: Box | null): { sx: number; sy: number; size: number } {
  const shortSide = Math.min(frame.width, frame.height);
  if (face === null) {
    return { sx: Math.round((frame.width - shortSide) / 2), sy: Math.round((frame.height - shortSide) / 2), size: shortSide };
  }

  const size = Math.min(Math.round(Math.max(face.width, face.height) * (1 + 2 * CROP_PADDING)), shortSide);
  const centreX = face.x + face.width / 2;
  const centreY = face.y + face.height / 2;
  const clamp = (value: number, max: number) => Math.min(Math.max(Math.round(value), 0), max);
  return { sx: clamp(centreX - size / 2, frame.width - size), sy: clamp(centreY - size / 2, frame.height - size), size };
}

/** When the current run of passing checks began, or `null` if the latest check failed. */
export function steadySince(previous: number | null, passing: boolean, now: number): number | null {
  if (!passing) return null;
  return previous ?? now;
}
