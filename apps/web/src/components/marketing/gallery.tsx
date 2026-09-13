'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { GALLERY_ITEMS } from '@/content/landing-content';
import { cn } from '@/lib/cn';
import { PhotoPlaceholder } from './brand';
import { Section, SectionHeading } from './section';

/**
 * Gallery with a lightbox (PRD LP-13, wireframe §11).
 *
 * One large photo and four smaller ones on desktop, not a uniform grid. The lightbox
 * and its dialog library load only when a photo is opened (ADR-033).
 */

const GalleryLightbox = dynamic(() => import('./gallery-lightbox').then((mod) => mod.GalleryLightbox), { ssr: false });

export function Gallery() {
  const t = useTranslations('gallery');
  const [open, setOpen] = useState<number | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const total = GALLERY_ITEMS.length;

  return (
    <Section tone="navy" labelledBy="gallery-heading">
      <SectionHeading id="gallery-heading">{t('h2')}</SectionHeading>

      <ul className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {GALLERY_ITEMS.slice(0, 5).map((item, i) => (
          <li key={item} className={cn(i === 0 && 'col-span-2 md:row-span-2')}>
            <button
              type="button"
              onClick={(event) => {
                opener.current = event.currentTarget;
                setOpen(i);
              }}
              aria-label={t('open', { n: i + 1, total })}
              aria-haspopup="dialog"
              className="block w-full rounded-photo"
            >
              <PhotoPlaceholder
                tone="onNavy"
                label={t(`items.${item}`)}
                caption={t(`items.${item}`)}
                aspect={i === 0 ? 'aspect-[4/3] md:aspect-auto md:h-full' : 'aspect-[4/3]'}
                className={cn(i === 0 && 'md:min-h-full')}
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
