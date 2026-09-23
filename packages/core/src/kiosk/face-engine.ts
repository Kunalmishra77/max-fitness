import type { MatchSettings } from './matcher';

/**
 * The seam the face engine plugs into (attendance spec §4).
 *
 * The spec writes this interface in Kotlin, for the Android kiosk. The client has
 * chosen a browser check-in page instead (ADR-072), so it is written here in
 * TypeScript — but for the same reason: **no part of the product may depend on which
 * model we ended up licensing.** Everything above this line works in embeddings and
 * scores, and nothing above it knows whether those came from FaceX, a vendor SDK or a
 * stub.
 *
 * That matters more than usual here. The engine is the one piece with a licence
 * attached, and the licence is the thing most likely to change.
 */

/**
 * One frame's pixels, as a canvas hands them over.
 *
 * Structural rather than the DOM's `ImageData`, because `packages/core` is imported
 * by the worker as well and must not need `lib.dom`. A browser `ImageData` satisfies
 * this exactly.
 */
export interface FaceFrame {
  readonly width: number;
  readonly height: number;
  /** RGBA, four bytes per pixel. */
  readonly data: Uint8ClampedArray;
}

export interface DetectedFace {
  /** Pixel box in the frame the caller passed in. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** 0–1. How sure the detector is that this is a face at all. */
  readonly confidence: number;
}

export interface FaceQuality {
  readonly ok: boolean;
  /** Why not, for the screen to explain: too far, too dark, turned away, blurred. */
  readonly reason: 'TOO_SMALL' | 'TOO_DARK' | 'TOO_BRIGHT' | 'BLURRED' | 'TURNED_AWAY' | null;
}

/**
 * What an engine has to be able to do.
 *
 * `embed` is the only method with no fallback: an engine that cannot turn a face into
 * a vector cannot recognise anybody, and the page falls back to the keypad. `liveness`
 * may return null — not every engine has it, and the page must not pretend it does.
 */
export interface FaceEngine {
  /** e.g. `facex-mfn-xs-1.0`. Stored on every template, so a model change is visible. */
  readonly modelVersion: string;
  readonly embeddingSize: number;
  /** Ready to use: weights fetched, runtime started. */
  ready(): Promise<void>;
  detect(frame: FaceFrame): Promise<readonly DetectedFace[]>;
  quality(frame: FaceFrame, face: DetectedFace): FaceQuality;
  /** L2-normalised. */
  embed(frame: FaceFrame, face: DetectedFace): Promise<readonly number[]>;
  /** 0–1, or null when this engine cannot tell a face from a photograph of one. */
  liveness(frame: FaceFrame, face: DetectedFace): Promise<number | null>;
}

export interface CheckInEngineSettings extends MatchSettings {
  /** Below this, a face that might be a photograph is refused (spec §6). */
  readonly livenessThreshold: number;
  /** BR-9.1. A second check-in inside this window is ignored, not recorded. */
  readonly cooldownMinutes: number;
  /** The kiosk records matches but greets nobody, until the owner has seen it get people right. */
  readonly shadowMode: boolean;
}

/**
 * Whether a frame is worth trying to recognise at all.
 *
 * Cheap checks first, before an embedding is computed: a face too small to be the
 * person standing at the desk, or one that is obviously a photograph, costs nothing
 * to reject and would cost a wrong greeting to accept.
 */
export function frameIsUsable(
  quality: FaceQuality,
  liveness: number | null,
  settings: Pick<CheckInEngineSettings, 'livenessThreshold'>,
): { usable: boolean; reason: FaceQuality['reason'] | 'NOT_LIVE' } {
  if (!quality.ok) return { usable: false, reason: quality.reason };
  // A null score means the engine cannot tell, not that the face failed. Refusing
  // everybody because the engine has no liveness check would break the whole page.
  if (liveness !== null && liveness < settings.livenessThreshold) return { usable: false, reason: 'NOT_LIVE' };
  return { usable: true, reason: null };
}
