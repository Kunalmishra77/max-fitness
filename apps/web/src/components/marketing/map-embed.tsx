'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { MapPinIcon } from './icons';

/**
 * Click-to-load Google Maps (PRD LP-19): until the visitor asks, the page makes no
 * request to Google, which keeps the first load fast and sets no third-party cookies
 * before consent.
 */
export function MapEmbed({ src }: { src: string }) {
  const t = useTranslations('contact');
  const [loaded, setLoaded] = useState(false);

  if (loaded) {
    return (
      <iframe
        src={src}
        title={t('mapTitle')}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        className="aspect-[4/3] w-full rounded-panel border-0"
      />
    );
  }

  return (
    // ADR-061: a dark, map-like plate with a red pin until the visitor asks for Google Maps.
    <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-4 rounded-panel border border-brand-obsidian/10 bg-brand-obsidian bg-[linear-gradient(rgb(255_255_255/0.05)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.05)_1px,transparent_1px)] bg-[size:28px_28px] p-6 text-center text-brand-paper">
      <span className="flex size-16 items-center justify-center rounded-full bg-brand-accent shadow-[0_0_0_10px_rgb(217_15_31/0.18)]">
        <MapPinIcon className="text-[1.75rem] text-brand-white" />
      </span>
      <button type="button" onClick={() => setLoaded(true)} className={buttonVariants({ variant: 'outlineLight' })}>
        {t('showMap')}
      </button>
      <p className="max-w-[32ch] text-small text-brand-mist">{t('mapNote')}</p>
    </div>
  );
}
