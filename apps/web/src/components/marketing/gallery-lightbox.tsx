'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useTranslations } from 'next-intl';
import type { KeyboardEvent } from 'react';
import { GALLERY_ITEMS } from '@/content/landing-content';
import { PhotoPlaceholder } from './brand';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from './icons';

/**
 * The gallery lightbox, loaded only when a photo is opened (ADR-033). A Radix dialog:
 * focus is trapped, Escape closes, and the arrow keys and buttons move between photos.
 */
export function GalleryLightbox({
  index,
  onIndexChange,
  onClose,
  onCloseAutoFocus,
}: {
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** Returns focus to the thumbnail that opened the lightbox. */
  onCloseAutoFocus: () => void;
}) {
  const t = useTranslations('gallery');
  const total = GALLERY_ITEMS.length;
  const current = GALLERY_ITEMS[index];

  const step = (delta: number) => onIndexChange((index + delta + total) % total);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
    }
  };

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-brand-ink/90" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onCloseAutoFocus();
          }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 p-4 text-brand-chalk focus:outline-none md:p-10"
        >
          {current === undefined ? null : (
            <>
              <div className="flex w-full max-w-5xl items-center justify-between gap-4">
                <DialogPrimitive.Title className="text-title font-semibold">{t(`items.${current}`)}</DialogPrimitive.Title>
                <DialogPrimitive.Close
                  aria-label={t('close')}
                  className="inline-flex size-11 items-center justify-center rounded-button text-[1.5rem]"
                >
                  <CloseIcon />
                </DialogPrimitive.Close>
              </div>
              <div className="w-full max-w-5xl">
                <PhotoPlaceholder
                  tone="onNavy"
                  label={t(`items.${current}`)}
                  caption={t('placeholder')}
                  aspect="aspect-[4/3] md:aspect-[16/10]"
                />
              </div>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => step(-1)}
                  aria-label={t('previous')}
                  className="inline-flex size-12 items-center justify-center rounded-full border-2 border-brand-chalk/60 text-[1.25rem]"
                >
                  <ChevronLeftIcon />
                </button>
                <p className="tabular min-w-16 text-center text-body" aria-live="polite">
                  {t('counter', { n: index + 1, total })}
                </p>
                <button
                  type="button"
                  onClick={() => step(1)}
                  aria-label={t('next')}
                  className="inline-flex size-12 items-center justify-center rounded-full border-2 border-brand-chalk/60 text-[1.25rem]"
                >
                  <ChevronRightIcon />
                </button>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
