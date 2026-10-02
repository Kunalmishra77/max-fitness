import type { Clock } from '@mfp/shared';
import { DomainError } from '../errors';
import { assertCan, type CrmActor } from '../crm/permissions';
import type { StorageDriver } from '../ports/storage';

/**
 * The gym's own photos on its own website (ADR-091).
 *
 * The landing page shipped with the gym's Google Business Profile uploads built in, which was
 * right for launch and wrong forever: the owner buys a new rack and cannot show it. These are
 * their own, uploaded from Max Register.
 *
 * Two rules the tests hold down. **A file that fails to record is deleted again**, because
 * every failed upload would otherwise be an orphan in a bucket nobody is watching — the same
 * discipline registration already uses for selfies. And **deleting a photo removes the bytes**,
 * not only the row: a photo taken off the website should be gone from the website.
 *
 * Dimensions are measured in the browser and sent with the file. The alternative is an image
 * library on the server to read a header, which is a dependency for one number the uploader
 * already has — and the numbers are bounds-checked here either way.
 */

export interface GalleryPhotoInput {
  readonly body: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly captionEn?: string | undefined;
  readonly captionHi?: string | undefined;
}

export interface GalleryStore {
  createPhoto(input: {
    readonly gymId: string;
    readonly storageKey: string;
    readonly width: number;
    readonly height: number;
    readonly sortOrder: number;
    readonly uploadedById: string;
    readonly captionEn?: string | undefined;
    readonly captionHi?: string | undefined;
  }): Promise<string>;
  nextSortOrder(gymId: string): Promise<number>;
  findPhoto(gymId: string, id: string): Promise<{ readonly id: string; readonly storageKey: string; readonly sortOrder: number } | null>;
  deletePhoto(gymId: string, id: string): Promise<void>;
  setPublished(gymId: string, id: string, isPublished: boolean): Promise<void>;
  setSortOrder(gymId: string, id: string, sortOrder: number): Promise<void>;
  /** Every photo, in display order, for working out what "one place up" means. */
  listOrdered(gymId: string): Promise<ReadonlyArray<{ readonly id: string; readonly sortOrder: number }>>;
}

export interface GalleryDeps {
  readonly actor: CrmActor;
  readonly clock: Clock;
  readonly store: GalleryStore;
  readonly storage: StorageDriver;
}

/** Smaller than this is a thumbnail or a mistake, not a photo of a gym. */
const MIN_EDGE = 400;
const MAX_EDGE = 6_000;
/** The browser shrinks before upload; this is the backstop. */
const MAX_BYTES = 3 * 1024 * 1024;

export async function addGalleryPhoto(input: GalleryPhotoInput, deps: GalleryDeps): Promise<string> {
  assertCan(deps.actor, 'settings.manage', deps.clock.now());

  if (input.body.length === 0 || input.body.length > MAX_BYTES) {
    throw new DomainError('VALIDATION_FAILED', 'That file is empty or too large', { field: 'photo' });
  }
  const { width, height } = input;
  if (!Number.isInteger(width) || !Number.isInteger(height) || Math.min(width, height) < MIN_EDGE || Math.max(width, height) > MAX_EDGE) {
    throw new DomainError('VALIDATION_FAILED', 'That picture is too small to show on the website', { field: 'photo' });
  }

  const stored = await deps.storage.put({ body: input.body, mimeType: 'image/jpeg', prefix: 'gallery' });
  try {
    return await deps.store.createPhoto({
      gymId: deps.actor.gymId,
      storageKey: stored.key,
      width,
      height,
      sortOrder: await deps.store.nextSortOrder(deps.actor.gymId),
      uploadedById: deps.actor.staffUserId,
      ...(input.captionEn === undefined ? {} : { captionEn: input.captionEn }),
      ...(input.captionHi === undefined ? {} : { captionHi: input.captionHi }),
    });
  } catch (error) {
    // Best effort: the caller needs the original failure, not a cleanup failure.
    await deps.storage.delete(stored.key).catch(() => undefined);
    throw error;
  }
}

export async function deleteGalleryPhoto(input: { readonly id: string }, deps: GalleryDeps): Promise<void> {
  assertCan(deps.actor, 'settings.manage', deps.clock.now());

  const found = await deps.store.findPhoto(deps.actor.gymId, input.id);
  if (found === null) throw new DomainError('NOT_FOUND', 'No such photo');

  await deps.store.deletePhoto(deps.actor.gymId, input.id);
  // The row is gone either way; a file that will not delete is logged by the caller.
  await deps.storage.delete(found.storageKey).catch(() => undefined);
}

export async function setGalleryPhotoPublished(input: { readonly id: string; readonly isPublished: boolean }, deps: GalleryDeps): Promise<void> {
  assertCan(deps.actor, 'settings.manage', deps.clock.now());

  const found = await deps.store.findPhoto(deps.actor.gymId, input.id);
  if (found === null) throw new DomainError('NOT_FOUND', 'No such photo');
  await deps.store.setPublished(deps.actor.gymId, input.id, input.isPublished);
}

/**
 * Move one photo one place (ADR-091).
 *
 * Swapping with its neighbour rather than renumbering everything: the owner moves one photo at
 * a time, and a swap cannot leave the list with two photos claiming the same place.
 */
export async function moveGalleryPhoto(input: { readonly id: string; readonly direction: 'UP' | 'DOWN' }, deps: GalleryDeps): Promise<void> {
  assertCan(deps.actor, 'settings.manage', deps.clock.now());

  const ordered = await deps.store.listOrdered(deps.actor.gymId);
  const index = ordered.findIndex((row) => row.id === input.id);
  if (index < 0) throw new DomainError('NOT_FOUND', 'No such photo');

  const otherIndex = input.direction === 'UP' ? index - 1 : index + 1;
  const mine = ordered[index];
  const other = ordered[otherIndex];
  // Already first or already last: nothing to do, and no error — the button is just spent.
  if (mine === undefined || other === undefined) return;

  await deps.store.setSortOrder(deps.actor.gymId, mine.id, other.sortOrder);
  await deps.store.setSortOrder(deps.actor.gymId, other.id, mine.sortOrder);
}
