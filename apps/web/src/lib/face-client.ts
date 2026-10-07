import { DEFAULT_PHOTO_GATES, type FaceMeasurement, type PhotoGates } from '@mfp/core';
import type { AttendanceSettings } from '@mfp/shared';

/**
 * Talking to `apps/face` (ADR-107).
 *
 * The one place in the web app that knows a face engine exists. It sends pixels and gets
 * back numbers; whose face it was, and whether those numbers are good enough, are decided
 * in `packages/core` where the rules are pure and tested.
 *
 * **Nothing here is stored or logged.** A frame arrives from the reception camera, goes to
 * the gym's own container on the gym's own private network, and is forgotten. The only
 * thing that outlives the request is the embedding, and only when a member is being
 * enrolled.
 */

export interface FaceResult {
  readonly measurement: FaceMeasurement;
  /** Present only when a face was found. L2-normalised, so matching is a dot product. */
  readonly embedding: readonly number[] | null;
  /** Stamped onto every template, so a model change is detectable rather than silent. */
  readonly modelVersion: string;
  readonly tookMs: number;
}

/** The engine is down or unreachable. The caller falls back to the keypad; it never guesses. */
export class FaceEngineUnavailableError extends Error {
  constructor(reason: string) {
    super(`The face engine is unavailable: ${reason}`);
    this.name = 'FaceEngineUnavailableError';
  }
}

interface EmbedResponse {
  found: boolean;
  reason?: string;
  modelVersion: string;
  embedding?: number[];
  tookMs?: number;
  face?: {
    facePx: number;
    confidence: number;
    brightness: number;
    alignedSharpness: number;
    facesInFrame: number;
    secondFacePx: number;
  };
}

export interface FaceClientConfig {
  readonly baseUrl: string;
  readonly token: string;
  /**
   * A member is standing at the desk waiting. Past a couple of seconds the right answer is
   * "use the keypad", not a longer spinner.
   */
  readonly timeoutMs?: number;
}

export class FaceClient {
  readonly #config: FaceClientConfig;

  constructor(config: FaceClientConfig) {
    this.#config = config;
  }

  get configured(): boolean {
    return this.#config.baseUrl !== '' && this.#config.token !== '';
  }

  async embed(image: Blob | Buffer, filename = 'frame.jpg'): Promise<FaceResult> {
    if (!this.configured) throw new FaceEngineUnavailableError('not configured');

    const form = new FormData();
    const blob = image instanceof Blob ? image : new Blob([new Uint8Array(image)], { type: 'image/jpeg' });
    form.append('image', blob, filename);

    let response: Response;
    try {
      response = await fetch(`${this.#config.baseUrl.replace(/\/$/, '')}/v1/embed`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.#config.token}` },
        body: form,
        signal: AbortSignal.timeout(this.#config.timeoutMs ?? 6000),
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'unreachable';
      throw new FaceEngineUnavailableError(reason);
    }

    if (!response.ok) {
      // Deliberately not the body: it is the engine's text, not a member's business.
      throw new FaceEngineUnavailableError(`HTTP ${response.status}`);
    }

    const body = (await response.json()) as EmbedResponse;
    if (!body.found || body.face === undefined || body.embedding === undefined) {
      // "No face in this photograph" is a normal answer, not a failure: a member points the
      // camera at the ceiling, or uploads a picture of their dog.
      return {
        measurement: { found: false, ...(body.reason === 'NOT_AN_IMAGE' ? { notAnImage: true } : {}) },
        embedding: null,
        modelVersion: body.modelVersion,
        tookMs: body.tookMs ?? 0,
      };
    }

    return {
      measurement: {
        found: true,
        facePx: body.face.facePx,
        confidence: body.face.confidence,
        brightness: body.face.brightness,
        alignedSharpness: body.face.alignedSharpness,
        facesInFrame: body.face.facesInFrame,
        secondFacePx: body.face.secondFacePx,
      },
      embedding: body.embedding,
      modelVersion: body.modelVersion,
      tookMs: body.tookMs ?? 0,
    };
  }
}

/**
 * The gym's own gates, or the measured defaults.
 *
 * Settings win, so the owner can tighten them from Max Register without a deploy — but the
 * defaults are the numbers ADR-107 measured, not round figures, so a gym that never touches
 * settings still gets the behaviour the POC proved.
 */
export function photoGatesFrom(attendance: AttendanceSettings): PhotoGates {
  return {
    enrolmentMinFacePx: attendance.enrolmentMinFacePx ?? DEFAULT_PHOTO_GATES.enrolmentMinFacePx,
    checkInMinFacePx: attendance.checkInMinFacePx ?? DEFAULT_PHOTO_GATES.checkInMinFacePx,
    minConfidence: attendance.faceMinConfidence ?? DEFAULT_PHOTO_GATES.minConfidence,
    minBrightness: attendance.faceMinBrightness ?? DEFAULT_PHOTO_GATES.minBrightness,
    maxBrightness: attendance.faceMaxBrightness ?? DEFAULT_PHOTO_GATES.maxBrightness,
    minAlignedSharpness: attendance.faceMinSharpness ?? DEFAULT_PHOTO_GATES.minAlignedSharpness,
    secondFaceRatio: attendance.secondFaceRatio ?? DEFAULT_PHOTO_GATES.secondFaceRatio,
  };
}
