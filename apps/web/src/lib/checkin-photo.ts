import { getContainer } from '@/lib/container';

/**
 * A member's photo for the reception tablet, behind a short-lived signed URL.
 *
 * Five minutes is plenty for the few seconds a candidate list is on screen, and
 * short enough that a URL copied off the tablet is worthless by the time anybody
 * pastes it anywhere (privacy doc §4).
 */

const PHOTO_TTL_SECONDS = 300;

export async function signedPhotoUrl(photoKey: string | null): Promise<string | null> {
  if (photoKey === null) return null;
  return getContainer().storage.signedUrl(photoKey, PHOTO_TTL_SECONDS);
}
