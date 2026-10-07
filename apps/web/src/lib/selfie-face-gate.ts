import {
  assessEnrolmentPhoto,
  photoGatesFrom,
  type PhotoRejection,
} from '@mfp/core';
import { FaceEngineUnavailableError } from '@mfp/integrations/face';
import type { AttendanceSettings } from '@mfp/shared';
import { getContainer } from '@/lib/container';

/**
 * Is this selfie good enough to mark the member in with, later? (ADR-107)
 *
 * The owner put it plainly: only approve a selfie that will actually work for attendance.
 * This is the moment to enforce it — the member is holding the phone, the camera is open,
 * and asking them to step closer costs them five seconds. Finding out three weeks later
 * that the gym cannot recognise them costs a conversation at the desk every single day.
 *
 * It is measured, not guessed. Every member whose selfie held a face of 192 px or more
 * scored 0.84–0.99 against degraded versions of themselves; the two at 43 px and 129 px
 * fell to 0.59 and 0.42, *below* where two different members score. There is nothing
 * further down the pipeline that can rescue a photograph taken from too far away.
 *
 * **It never blocks sign-up because the engine is down.** If the face service cannot be
 * reached, the selfie is accepted and the member is simply left unenrolled for the backfill
 * script to pick up. A gym that cannot take a new member because a container is restarting
 * is a worse failure than one whose newest member has to use the keypad for a day.
 */

export type SelfieFaceVerdict =
  | { readonly ok: true; readonly embedding: readonly number[]; readonly modelVersion: string; readonly facePx: number }
  /** Checked, and this photograph will not do. The member is told, in their own language. */
  | { readonly ok: false; readonly reason: PhotoRejection }
  /** Not checked at all — no engine configured, or it could not be reached. */
  | { readonly ok: true; readonly embedding: null; readonly modelVersion: null; readonly facePx: null };

export async function checkSelfieFace(jpeg: Uint8Array, attendance: AttendanceSettings): Promise<SelfieFaceVerdict> {
  const { face } = getContainer();
  const unchecked = { ok: true, embedding: null, modelVersion: null, facePx: null } as const;
  if (!face.configured) return unchecked;

  let measured;
  try {
    measured = await face.embed(Buffer.from(jpeg), 'selfie.jpg');
  } catch (error) {
    if (error instanceof FaceEngineUnavailableError) {
      // Logged without anything about the person: a member signing up is not the news here.
      console.warn(`[selfie-gate] face engine unavailable; accepting the selfie unchecked`);
      return unchecked;
    }
    throw error;
  }

  const verdict = assessEnrolmentPhoto(measured.measurement, photoGatesFrom(attendance));
  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  // The embedding is already computed, so the member is enrolled from this same call rather
  // than from a second pass over a photograph that has just been through the engine.
  return {
    ok: true,
    embedding: measured.embedding ?? [],
    modelVersion: measured.modelVersion,
    facePx: measured.measurement.found ? measured.measurement.facePx : 0,
  };
}
