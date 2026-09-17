import { cn } from '@/lib/cn';

/**
 * A real photo of the gym (PRD LP-06/07/13; ADR-057).
 *
 * The files are made ahead of time by `scripts/build-site-photos.mjs`: AVIF and WebP in
 * a few widths, re-encoded without metadata. A plain `<picture>` serves them — the same
 * approach as the hero posters — so there is no image service in the request path and
 * the browser picks the smallest file that fits the slot.
 */

export interface SitePhotoData {
  readonly id: string;
  /** Size of the largest generated file. */
  readonly width: number;
  readonly height: number;
  /** Widths that exist on disk, smallest first. */
  readonly widths: readonly number[];
}

const PREFERRED_FALLBACK_WIDTH = 1080;

const srcSet = (photo: SitePhotoData, format: 'avif' | 'webp') =>
  photo.widths.map((width) => `/media/photos/${photo.id}-${width}.${format} ${width}w`).join(', ');

export function SitePhoto({
  photo,
  alt,
  sizes,
  aspect,
  className,
  priority = false,
  fit = 'cover',
}: {
  /** `contain` shows the whole photo (the lightbox); `cover` fills the box (tiles). */
  fit?: 'cover' | 'contain';
  photo: SitePhotoData;
  alt: string;
  sizes: string;
  /** A Tailwind aspect class for the box, e.g. `aspect-[4/3]`. */
  aspect: string;
  className?: string;
  priority?: boolean;
}) {
  const fallbackWidth = photo.widths.includes(PREFERRED_FALLBACK_WIDTH) ? PREFERRED_FALLBACK_WIDTH : (photo.widths.at(-1) ?? photo.width);

  return (
    <div className={cn('relative w-full overflow-hidden bg-brand-plate-navy', aspect, className)}>
      <picture>
        <source type="image/avif" srcSet={srcSet(photo, 'avif')} sizes={sizes} />
        <source type="image/webp" srcSet={srcSet(photo, 'webp')} sizes={sizes} />
        <img
          src={`/media/photos/${photo.id}-${fallbackWidth}.webp`}
          alt={alt}
          width={photo.width}
          height={photo.height}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : 'auto'}
          className={cn('absolute inset-0 size-full', fit === 'contain' ? 'object-contain' : 'object-cover')}
        />
      </picture>
    </div>
  );
}
