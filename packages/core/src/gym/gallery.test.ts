import { beforeEach, describe, expect, it } from 'vitest';
import { fakeClockAt } from '../testing/builders';
import type { CrmActor } from '../crm/permissions';
import type { PutObjectRequest, StorageDriver } from '../ports/storage';
import { addGalleryPhoto, deleteGalleryPhoto, moveGalleryPhoto, setGalleryPhotoPublished, type GalleryStore } from './gallery';

/**
 * The gym's own photos on its own website (ADR-091).
 *
 * The rules worth holding: only the owner changes what the public sees, a photo that fails to
 * record is not left sitting in storage paying rent, and deleting one removes the bytes rather
 * than only the row — a photo taken off the website should be gone from the website.
 */

const clock = fakeClockAt('2026-11-04T10:00');
const owner: CrmActor = { staffUserId: 'staff_1', gymId: 'gym_1', role: 'OWNER', elevatedUntil: new Date(clock.now().getTime() + 60_000), receptionMayTakePayments: true };
const reception: CrmActor = { ...owner, staffUserId: 'staff_2', role: 'RECEPTION' };

class FakeStorage implements StorageDriver {
  readonly name = 'local' as const;
  readonly objects = new Map<string, Uint8Array>();
  failNextPut = false;

  put(request: PutObjectRequest) {
    if (this.failNextPut) throw new Error('storage is down');
    const key = `gallery/${this.objects.size + 1}.jpg`;
    this.objects.set(key, request.body);
    return Promise.resolve({ key, sizeBytes: request.body.length, mimeType: 'image/jpeg', sha256: 'x'.repeat(64) });
  }
  get(key: string) {
    return Promise.resolve(this.objects.get(key) ?? new Uint8Array());
  }
  delete(key: string) {
    this.objects.delete(key);
    return Promise.resolve();
  }
  exists(key: string) {
    return Promise.resolve(this.objects.has(key));
  }
  signedUrl(key: string) {
    return Promise.resolve(`https://files.test/${key}`);
  }
}

class FakeGalleryStore implements GalleryStore {
  readonly photos = new Map<string, { storageKey: string; sortOrder: number; isPublished: boolean }>();
  failNextCreate = false;

  createPhoto(input: { gymId: string; storageKey: string; width: number; height: number; sortOrder: number; uploadedById: string }) {
    if (this.failNextCreate) return Promise.reject(new Error('the row could not be written'));
    const id = `photo_${this.photos.size + 1}`;
    this.photos.set(id, { storageKey: input.storageKey, sortOrder: input.sortOrder, isPublished: true });
    return Promise.resolve(id);
  }
  nextSortOrder() {
    return Promise.resolve(this.photos.size);
  }
  findPhoto(_gymId: string, id: string) {
    const found = this.photos.get(id);
    return Promise.resolve(found === undefined ? null : { id, storageKey: found.storageKey, sortOrder: found.sortOrder });
  }
  deletePhoto(_gymId: string, id: string) {
    this.photos.delete(id);
    return Promise.resolve();
  }
  setPublished(_gymId: string, id: string, isPublished: boolean) {
    const found = this.photos.get(id);
    if (found !== undefined) this.photos.set(id, { ...found, isPublished });
    return Promise.resolve();
  }
  setSortOrder(_gymId: string, id: string, sortOrder: number) {
    const found = this.photos.get(id);
    if (found !== undefined) this.photos.set(id, { ...found, sortOrder });
    return Promise.resolve();
  }
  listOrdered() {
    return Promise.resolve(
      [...this.photos.entries()].map(([id, row]) => ({ id, sortOrder: row.sortOrder })).sort((a, b) => a.sortOrder - b.sortOrder),
    );
  }
}

const deps = (store: FakeGalleryStore, storage: FakeStorage, actor: CrmActor = owner) => ({ actor, clock, store, storage });

const photo = { body: new Uint8Array([1, 2, 3]), width: 1600, height: 1200 };

describe('addGalleryPhoto', () => {
  let store: FakeGalleryStore;
  let storage: FakeStorage;
  beforeEach(() => {
    store = new FakeGalleryStore();
    storage = new FakeStorage();
  });

  it('stores the file and records it at the end of the gallery', async () => {
    const id = await addGalleryPhoto(photo, deps(store, storage));

    expect(storage.objects.size).toBe(1);
    expect(store.photos.get(id)?.sortOrder).toBe(0);
  });

  it('does not leave the file behind when the row cannot be written', async () => {
    // Otherwise every failed upload is an orphan in a bucket nobody is watching.
    store.failNextCreate = true;
    await expect(addGalleryPhoto(photo, deps(store, storage))).rejects.toThrow();
    expect(storage.objects.size).toBe(0);
  });

  it('refuses a picture that is not a picture, or one too small to show', async () => {
    await expect(addGalleryPhoto({ ...photo, width: 40, height: 30 }, deps(store, storage))).rejects.toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }) as Error,
    );
    await expect(addGalleryPhoto({ ...photo, body: new Uint8Array() }, deps(store, storage))).rejects.toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }) as Error,
    );
  });

  it('is the owner’s, behind the PIN', async () => {
    await expect(addGalleryPhoto(photo, deps(store, storage, reception))).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }) as Error);
  });
});

describe('deleteGalleryPhoto', () => {
  it('removes the row and the bytes', async () => {
    const store = new FakeGalleryStore();
    const storage = new FakeStorage();
    const id = await addGalleryPhoto(photo, deps(store, storage));

    await deleteGalleryPhoto({ id }, deps(store, storage));

    expect(store.photos.size).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  it('refuses a photo that is not this gym’s', async () => {
    const store = new FakeGalleryStore();
    await expect(deleteGalleryPhoto({ id: 'nope' }, deps(store, new FakeStorage()))).rejects.toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }) as Error,
    );
  });
});

describe('ordering and publishing', () => {
  it('moves a photo up past the one before it', async () => {
    const store = new FakeGalleryStore();
    const storage = new FakeStorage();
    const first = await addGalleryPhoto(photo, deps(store, storage));
    const second = await addGalleryPhoto(photo, deps(store, storage));

    await moveGalleryPhoto({ id: second, direction: 'UP' }, deps(store, storage));

    expect(store.photos.get(second)?.sortOrder).toBe(0);
    expect(store.photos.get(first)?.sortOrder).toBe(1);
  });

  it('does nothing when the first photo is moved up', async () => {
    const store = new FakeGalleryStore();
    const storage = new FakeStorage();
    const only = await addGalleryPhoto(photo, deps(store, storage));

    await moveGalleryPhoto({ id: only, direction: 'UP' }, deps(store, storage));
    expect(store.photos.get(only)?.sortOrder).toBe(0);
  });

  it('takes a photo off the website without deleting it', async () => {
    const store = new FakeGalleryStore();
    const storage = new FakeStorage();
    const id = await addGalleryPhoto(photo, deps(store, storage));

    await setGalleryPhotoPublished({ id, isPublished: false }, deps(store, storage));

    expect(store.photos.get(id)?.isPublished).toBe(false);
    expect(storage.objects.size).toBe(1);
  });
});
