import type { SitePhotoData } from '@/components/marketing/site-photo';
import type { FacilityZone } from './landing-content';
import generated from './site-photos.generated.json';

/**
 * Which real photo goes where on the website (ADR-057).
 *
 * The photos are the gym's own uploads to its Google Business Profile, generated into
 * `public/media/photos` by `scripts/build-site-photos.mjs`. A `null` slot keeps its
 * "photo coming soon" placeholder until the gym sends that photo — no photo from another
 * gym and no stock image stands in for it.
 */

export type SitePhotoId = keyof typeof generated;

export const SITE_PHOTOS: Readonly<Record<SitePhotoId, SitePhotoData>> = generated;

export const ABOUT_PHOTOS = {
  main: 'floor-treadmills',
  inset: 'trainer-spot',
} as const satisfies Record<string, SitePhotoId>;

/** Strength and boxing have no recent photo yet (the uploads show the renovated cardio and turf areas). */
export const FACILITY_PHOTOS: Readonly<Record<FacilityZone, SitePhotoId | null>> = {
  strength: null,
  cardio: 'cardio-crossfit',
  boxing: null,
  functional: 'functional-turf',
};

/** The first is the large tile; the lightbox shows all of them in this order. */
export const GALLERY_PHOTOS: readonly SitePhotoId[] = [
  'champions-team',
  'floor-treadmills',
  'functional-turf',
  'cardio-crossfit',
  'champion-trophies',
  'cardio-steps',
  'champions-trio',
  'trainer-spot',
];
