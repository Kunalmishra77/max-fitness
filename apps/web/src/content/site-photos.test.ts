import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import hi from '../../messages/hi.json';
import { FACILITY_ZONES } from './landing-content';
import { ABOUT_PHOTOS, FACILITY_PHOTOS, GALLERY_PHOTOS, SITE_PHOTOS } from './site-photos';

/**
 * The website's photos and where they go (ADR-057).
 *
 * A slot may be empty — the placeholder stays until the gym sends that photo — but a
 * slot that names a photo must find it: generated, on disk in both formats and every
 * width, and described in both languages.
 */

// The browser-like test environment has no file URL for this module; try both roots.
const publicDir = [resolve(process.cwd(), 'public'), resolve(process.cwd(), 'apps/web/public')].find((dir) => existsSync(dir)) ?? '';

const used = [ABOUT_PHOTOS.main, ABOUT_PHOTOS.inset, ...Object.values(FACILITY_PHOTOS), ...GALLERY_PHOTOS].filter((id): id is keyof typeof SITE_PHOTOS => id !== null);

describe('site photos', () => {
  it('names only photos that were generated', () => {
    for (const id of used) expect(SITE_PHOTOS[id], id).toBeDefined();
  });

  it('has every width on disk, in AVIF and WebP', () => {
    for (const photo of Object.values(SITE_PHOTOS)) {
      for (const width of photo.widths) {
        for (const format of ['avif', 'webp']) {
          expect(existsSync(resolve(publicDir, 'media/photos', `${photo.id}-${width}.${format}`)), `${photo.id}-${width}.${format}`).toBe(true);
        }
      }
    }
  });

  it('describes every photo in English and Hindi', () => {
    const enPhotos = (en as { photos?: Record<string, string> }).photos ?? {};
    const hiPhotos = (hi as { photos?: Record<string, string> }).photos ?? {};
    for (const id of Object.keys(SITE_PHOTOS)) {
      expect(enPhotos[id]?.trim(), `en ${id}`).toBeTruthy();
      expect(hiPhotos[id]?.trim(), `hi ${id}`).toBeTruthy();
    }
  });

  it('fills the gallery with at least five photos, none twice, and covers every facility zone with a photo or an honest gap', () => {
    expect(GALLERY_PHOTOS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(GALLERY_PHOTOS).size).toBe(GALLERY_PHOTOS.length);
    expect(Object.keys(FACILITY_PHOTOS).sort()).toEqual([...FACILITY_ZONES].sort());
  });
});
