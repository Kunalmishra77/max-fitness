'use client';

import { useTranslations } from 'next-intl';
import { useState, useSyncExternalStore } from 'react';
import { CloseIcon } from './icons';

/**
 * Announcement bar above the navigation (PRD LP-02, ADR-024).
 *
 * Dismissal lasts for the browser session and is remembered against the text itself,
 * so a new offer from the CRM shows again even to someone who closed the last one.
 */

const STORAGE_KEY = 'mfp-promo-bar-dismissed';
const neverChanges = () => () => {};

function readDismissed(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked (private mode, strict settings); then the bar just shows.
    return null;
  }
}

export function PromoBar({ text, whatsappHref }: { text: string; whatsappHref: string }) {
  const t = useTranslations('promo');
  const storedDismissal = useSyncExternalStore(neverChanges, readDismissed, () => null);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || storedDismissal === text) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(STORAGE_KEY, text);
    } catch {
      // Not remembered; it will show again on the next page.
    }
  };

  return (
    <div className="bg-brand-accent-deep text-brand-white">
      <div className="mx-auto flex max-w-[var(--size-content-max)] items-center gap-2 px-5 md:px-6">
        <p className="flex-1 py-2 text-small font-medium md:text-center">
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            data-track="whatsapp_click"
            data-track-source="promo_bar"
            className="underline-offset-4 hover:underline"
          >
            {text}
          </a>
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('barDismiss')}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-button"
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
