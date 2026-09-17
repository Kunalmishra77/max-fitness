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

export function Gallery() {
  const t = useTranslations('gallery');
  const tp = useTranslations('photos');
  const [open, setOpen] = useState<number | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const total = GALLERY_PHOTOS.length;

  return (
    <Section tone="navy" labelledBy="gallery-heading">
      <SectionHeading id="gallery-heading">{t('h2')}</SectionHeading>

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
              className={cn('block w-full rounded-photo', i === 0 && 'md:h-full')}
            >
              <SitePhoto
                photo={SITE_PHOTOS[id]}
                alt={tp(id)}
                sizes={i === 0 ? '(min-width: 768px) 50vw, 100vw' : '(min-width: 768px) 25vw, 50vw'}
                aspect={i === 0 ? 'aspect-[4/3] md:aspect-auto md:h-full' : 'aspect-[4/3]'}
                className={cn('rounded-photo', i === 0 && 'md:min-h-full')}
              />
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
