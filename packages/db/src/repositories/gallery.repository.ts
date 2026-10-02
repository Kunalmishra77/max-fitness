import type { GalleryStore } from '@mfp/core';
import type { PrismaClient } from '../client';

/**
 * The gym's website photos against the database (ADR-091).
 *
 * `sortOrder` is the display order and is only ever written in pairs by a swap, so the list
 * cannot end up with two photos claiming the same place.
 */

export interface GalleryPhotoRow {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly captionEn: string | null;
  readonly captionHi: string | null;
  readonly isPublished: boolean;
  readonly sortOrder: number;
}

export class PrismaGallery implements GalleryStore {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async createPhoto(input: Parameters<GalleryStore['createPhoto']>[0]): Promise<string> {
    const created = await this.#prisma.galleryPhoto.create({
      data: {
        gymId: input.gymId,
        storageKey: input.storageKey,
        width: input.width,
        height: input.height,
        sortOrder: input.sortOrder,
        uploadedById: input.uploadedById,
        captionEn: input.captionEn ?? null,
        captionHi: input.captionHi ?? null,
      },
      select: { id: true },
    });
    return created.id;
  }

  async nextSortOrder(gymId: string): Promise<number> {
    const last = await this.#prisma.galleryPhoto.findFirst({ where: { gymId }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
    return (last?.sortOrder ?? -1) + 1;
  }

  async findPhoto(gymId: string, id: string) {
    return await this.#prisma.galleryPhoto.findFirst({ where: { id, gymId }, select: { id: true, storageKey: true, sortOrder: true } });
  }

  async deletePhoto(gymId: string, id: string): Promise<void> {
    await this.#prisma.galleryPhoto.deleteMany({ where: { id, gymId } });
  }

  async setPublished(gymId: string, id: string, isPublished: boolean): Promise<void> {
    await this.#prisma.galleryPhoto.updateMany({ where: { id, gymId }, data: { isPublished } });
  }

  async setSortOrder(gymId: string, id: string, sortOrder: number): Promise<void> {
    await this.#prisma.galleryPhoto.updateMany({ where: { id, gymId }, data: { sortOrder } });
  }

  async listOrdered(gymId: string) {
    return await this.#prisma.galleryPhoto.findMany({ where: { gymId }, orderBy: { sortOrder: 'asc' }, select: { id: true, sortOrder: true } });
  }

  /** Everything the CRM screen shows, in order, published or not. */
  async all(gymId: string): Promise<GalleryPhotoRow[]> {
    return await this.#prisma.galleryPhoto.findMany({
      where: { gymId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, width: true, height: true, captionEn: true, captionHi: true, isPublished: true, sortOrder: true },
    });
  }

  /** What the website shows. Empty means the built-in photos stay. */
  async published(gymId: string): Promise<GalleryPhotoRow[]> {
    return await this.#prisma.galleryPhoto.findMany({
      where: { gymId, isPublished: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, width: true, height: true, captionEn: true, captionHi: true, isPublished: true, sortOrder: true },
    });
  }

  /** The stored file behind a public photo, for the route that serves it. */
  async storageKeyOf(id: string): Promise<string | null> {
    const row = await this.#prisma.galleryPhoto.findFirst({ where: { id, isPublished: true }, select: { storageKey: true } });
    return row?.storageKey ?? null;
  }
}
