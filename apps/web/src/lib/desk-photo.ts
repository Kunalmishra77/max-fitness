import { MAX_SELFIE_BYTES, processSelfie, SelfieRejectedError, type ProcessedSelfie } from './selfie-image';

/**
 * The member photo the desk took (crm-ux-blueprint §7).
 *
 * The wizard sends it as the `photo` field of a form, next to the member's details. It
 * is untrusted exactly like a selfie from the website (security-plan §3.1), so it goes
 * through the same pipeline: signature check, decode, re-encode without metadata. A
 * missing photo is a normal answer — the desk may skip it — and returns `null`.
 */
export async function deskPhotoFromForm(form: FormData | null): Promise<ProcessedSelfie | null> {
  const entry = form?.get('photo') ?? null;
  if (entry === null) return null;
  if (typeof entry === 'string') throw new SelfieRejectedError('unsupported_type');
  // Refuse by size before reading a byte of it.
  if (entry.size > MAX_SELFIE_BYTES) throw new SelfieRejectedError('too_large');
  return processSelfie(new Uint8Array(await entry.arrayBuffer()));
}
