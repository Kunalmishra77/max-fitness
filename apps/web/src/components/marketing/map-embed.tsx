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
    <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-panel border border-brand-rubber-grey/25 bg-brand-white p-6 text-center">
      <MapPinIcon className="text-[2rem] text-brand-plate-navy" />
      <button type="button" onClick={() => setLoaded(true)} className={buttonVariants({ variant: 'outlineDark' })}>
        {t('showMap')}
      </button>
      <p className="max-w-[32ch] text-small text-brand-rubber-grey">{t('mapNote')}</p>
    </div>
  );
}
