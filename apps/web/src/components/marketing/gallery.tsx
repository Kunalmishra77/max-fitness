'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { GALLERY_PHOTOS, SITE_PHOTOS } from '@/content/site-photos';
import { cn } from '@/lib/cn';
import { Section, SectionHeading } from './section';
import { SitePhoto } from './site-photo';

/**
 * Gallery with a lightbox (PRD LP-13, wireframe §11).
 *
 * One large photo and four smaller ones on desktop, not a uniform grid. The lightbox
 * and its dialog library load only when a photo is opened (ADR-033). The photos are
 * the gym's own Google Business Profile uploads (ADR-057).
 */

const GalleryLightbox = dynamic(() => import('./gallery-lightbox').then((mod) => mod.GalleryLightbox), { ssr: false });

/** A photo the owner uploaded from Max Register (ADR-091). */
export interface OwnGalleryPhoto {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly caption: string | null;
}

export function Gallery({ own = [] }: { readonly own?: readonly OwnGalleryPhoto[] }) {
  const t = useTranslations('gallery');
  const tp = useTranslations('photos');
  const [open, setOpen] = useState<number | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);

  // The gym's own photos replace the built-in set entirely once there is one, rather than
  // mixing the two — a gallery half from last year and half from today looks like a mistake.
  if (own.length > 0) {
    return (
      <Section tone="navy" labelledBy="gallery-heading">
        <SectionHeading id="gallery-heading" eyebrow={t('eyebrow')} onDark>
          {t('h2')}
        </SectionHeading>
        <ul className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          {own.slice(0, 8).map((photo, i) => (
            <li key={photo.id} className={cn(i === 0 && 'col-span-2 md:row-span-2')}>
              {/* Served by our own public route; next/image would only re-cache a file we
                  already serve immutably, and the id changes whenever the photo does. */}
              <img
                src={`/api/v1/gallery/${photo.id}`}
                alt={photo.caption ?? ''}
                width={photo.width}
                height={photo.height}
                loading={i === 0 ? 'eager' : 'lazy'}
                className={cn('w-full rounded-photo object-cover', i === 0 ? 'aspect-[4/3] md:h-full' : 'aspect-[4/3]')}
              />
            </li>
          ))}
        </ul>
      </Section>
    );
  }

  const total = GALLERY_PHOTOS.length;

  return (
    <Section tone="navy" labelledBy="gallery-heading">
      <SectionHeading id="gallery-heading" eyebrow={t('eyebrow')} onDark>
        {t('h2')}
      </SectionHeading>

      <ul className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {GALLERY_PHOTOS.slice(0, 5).map((id, i) => (
          <li key={id} className={cn(i === 0 && 'col-span-2 md:row-span-2')}>
            <button
              type="button"
              onClick={(event) => {
                opener.current = event.currentTarget;
                setOpen(i);
              }}
              aria-label={t('open', { n: i + 1, total })}
              aria-haspopup="dialog"
              // The large tile takes its height from the two grid rows it spans; the photo
              // inside is absolutely placed and gives the button no height of its own.
              className={cn('photo-zoom group relative block w-full rounded-photo', i === 0 && 'md:h-full')}
            >
              <SitePhoto
                photo={SITE_PHOTOS[id]}
                alt={tp(id)}
                sizes={i === 0 ? '(min-width: 768px) 50vw, 100vw' : '(min-width: 768px) 25vw, 50vw'}
                aspect={i === 0 ? 'aspect-[4/3] md:aspect-auto md:h-full' : 'aspect-[4/3]'}
                className={cn('rounded-photo', i === 0 && 'md:min-h-full')}
              />
              {/* On hover the photo darkens toward red and a plus invites the lightbox (ADR-061). */}
              <span
                aria-hidden
                className="absolute inset-0 flex items-center justify-center rounded-photo bg-gradient-to-t from-brand-accent/70 via-brand-obsidian/30 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100"
              >
                <span className="flex size-12 items-center justify-center rounded-full border-2 border-brand-white font-display text-display-m leading-none text-brand-white">+</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {open === null ? null : (
        <GalleryLightbox
          index={open}
          onIndexChange={setOpen}
          onClose={() => setOpen(null)}
          onCloseAutoFocus={() => opener.current?.focus({ preventScroll: true })}
        />
      )}
    </Section>
  );
}
