import type { FaceTemplateRow } from '@mfp/core';
import { PrismaFaceTemplates, keyFromEnv } from '@mfp/db';
import { getContainer } from '@/lib/container';

/**
 * The gallery the camera is matched against, held in memory for a few seconds (ADR-107).
 *
 * The camera sends a frame roughly every second while somebody is standing there, and each
 * one has to be compared against every member. Reading and **decrypting** the whole gallery
 * per frame would mean a few hundred AES operations a second to answer a question whose
 * answer changed last week.
 *
 * So it is cached — but only briefly. A member enrolled a minute ago must be recognised on
 * their first visit, and a member whose templates were revoked must stop being recognised
 * quickly, because that revocation is usually the point. Ten seconds is short enough that
 * neither is a surprise and long enough that a whole check-in costs one read.
 */

const TTL_MS = 10_000;

interface Cached {
  readonly gallery: readonly FaceTemplateRow[];
  readonly loadedAt: number;
}

// On `globalThis` for the same reason the Prisma client is: Next may evaluate this module
// more than once, and a cache per copy would be no cache at all.
const store = globalThis as unknown as { __mfpFaceGallery?: Map<string, Cached> };
store.__mfpFaceGallery ??= new Map<string, Cached>();

export interface GalleryView {
  readonly gallery: readonly FaceTemplateRow[];
  /** Members with at least one usable template — what the screen means by "nobody enrolled". */
  readonly enrolledMembers: number;
}

export async function faceGallery(gymId: string, modelVersion: string): Promise<GalleryView> {
  const key = `${gymId}:${modelVersion}`;
  const cached = store.__mfpFaceGallery?.get(key);
  const now = Date.now();
  if (cached !== undefined && now - cached.loadedAt < TTL_MS) {
    return { gallery: cached.gallery, enrolledMembers: new Set(cached.gallery.map((t) => t.memberId)).size };
  }

  const { prisma, env } = getContainer();
  const gallery = await new PrismaFaceTemplates(prisma, keyFromEnv(env.FIELD_ENCRYPTION_KEY)).gallery(gymId, modelVersion);
  store.__mfpFaceGallery?.set(key, { gallery, loadedAt: now });
  return { gallery, enrolledMembers: new Set(gallery.map((t) => t.memberId)).size };
}

/** Called when a template is written or revoked, so the next frame sees it. */
export function forgetFaceGallery(gymId: string): void {
  for (const key of [...(store.__mfpFaceGallery?.keys() ?? [])]) {
    if (key.startsWith(`${gymId}:`)) store.__mfpFaceGallery?.delete(key);
  }
}
