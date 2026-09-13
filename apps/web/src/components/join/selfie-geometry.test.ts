import { describe, expect, it } from 'vitest';
import { FACE_STEADY_MS, faceCheck, squareCrop, steadySince } from './selfie-geometry';

const frame = { width: 1280, height: 720 };
/** A face box centred in the frame, `share` of the frame's width wide. */
const centred = (share: number) => {
  const width = frame.width * share;
  return { x: (frame.width - width) / 2, y: (frame.height - width) / 2, width, height: width };
};

describe('faceCheck', () => {
  it('passes exactly one face, large enough, inside the oval', () => {
    expect(faceCheck([centred(0.4)], frame)).toBe('ok');
  });

  it('asks for a face when there is none, and for one person when there are several', () => {
    expect(faceCheck([], frame)).toBe('none');
    expect(faceCheck([centred(0.4), { ...centred(0.4), x: 10 }], frame)).toBe('multiple');
  });

  it('asks to come closer when the face is under 35% of the frame width', () => {
    expect(faceCheck([centred(0.3)], frame)).toBe('small');
  });

  it('asks to move into the oval when the face is off to one side', () => {
    expect(faceCheck([{ ...centred(0.4), x: 20 }], frame)).toBe('offCentre');
  });
});

describe('squareCrop', () => {
  it('frames the face with 40% padding on each side', () => {
    const face = { x: 540, y: 260, width: 200, height: 200 };
    expect(squareCrop(frame, face)).toEqual({ sx: 460, sy: 180, size: 360 });
  });

  it('stays inside the frame when the face is near an edge', () => {
    const crop = squareCrop(frame, { x: 1100, y: 20, width: 300, height: 300 });
    expect(crop.sx + crop.size).toBeLessThanOrEqual(frame.width);
    expect(crop.sy).toBeGreaterThanOrEqual(0);
    expect(crop.size).toBe(540);
  });

  it('never asks for a square larger than the frame', () => {
    expect(squareCrop(frame, { x: 0, y: 0, width: 700, height: 700 }).size).toBe(720);
  });

  it('takes the centred square when no face box is known', () => {
    expect(squareCrop(frame, null)).toEqual({ sx: 280, sy: 0, size: 720 });
  });
});

describe('steadySince', () => {
  it('starts timing when the face first passes, keeps the start while it holds, and resets when it fails', () => {
    expect(steadySince(null, true, 1_000)).toBe(1_000);
    expect(steadySince(1_000, true, 1_400)).toBe(1_000);
    expect(steadySince(1_000, false, 1_450)).toBeNull();
  });

  it('allows capture after the face has held for half a second', () => {
    expect(FACE_STEADY_MS).toBe(500);
  });
});
