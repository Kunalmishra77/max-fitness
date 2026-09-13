import sharp, { type OutputInfo } from 'sharp';

/**
 * The selfie upload pipeline (security-plan.md §3.1; api-specification.md `POST /registrations`).
 *
 * An upload is untrusted bytes. The declared content type is ignored: the file must
 * start with a JPEG, PNG or WebP signature, must decode, and is then re-encoded from
 * pixels — which drops EXIF (a phone photo can carry the member's home location),
 * ICC data and anything a polyglot file smuggled after the image. What is stored is
 * always a fresh JPEG no larger than 720px.
 */

export const MAX_SELFIE_BYTES = 2 * 1024 * 1024;
/** Anything smaller cannot be matched reliably by the kiosk later (attendance spec §3). */
const MIN_SHORT_SIDE_PX = 240;
const MAX_SIDE_PX = 720;
/** Decompression-bomb guard: a 2 MB file may still claim enormous dimensions. */
const MAX_INPUT_PIXELS = 40_000_000;

export type ImageType = 'jpeg' | 'png' | 'webp';
export type SelfieRejection = 'too_large' | 'unsupported_type' | 'unreadable' | 'too_small';

export class SelfieRejectedError extends Error {
  readonly reason: SelfieRejection;

  constructor(reason: SelfieRejection) {
    super(`Selfie rejected: ${reason}`);
    this.name = 'SelfieRejectedError';
    this.reason = reason;
  }
}

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((byte, i) => bytes[offset + i] === byte);

export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  // "RIFF" <size> "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  return null;
}

export interface ProcessedSelfie {
  readonly body: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export async function processSelfie(bytes: Uint8Array): Promise<ProcessedSelfie> {
  if (bytes.byteLength > MAX_SELFIE_BYTES) throw new SelfieRejectedError('too_large');
  if (detectImageType(bytes) === null) throw new SelfieRejectedError('unsupported_type');

  let upright: { data: Buffer; info: OutputInfo };
  try {
    // Apply EXIF orientation first, so the dimensions checked are the ones a person sees.
    upright = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      .rotate()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new SelfieRejectedError('unreadable');
  }

  if (Math.min(upright.info.width, upright.info.height) < MIN_SHORT_SIDE_PX) {
    throw new SelfieRejectedError('too_small');
  }

  const { data, info } = await sharp(upright.data, {
    raw: { width: upright.info.width, height: upright.info.height, channels: upright.info.channels },
  })
    .resize({ width: MAX_SIDE_PX, height: MAX_SIDE_PX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    // No `.withMetadata()`: sharp writes none by default, which is the point.
    .toBuffer({ resolveWithObject: true });

  return { body: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
}
