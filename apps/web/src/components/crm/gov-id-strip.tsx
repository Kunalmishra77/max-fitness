'use client';

import { useTranslations } from 'next-intl';

export interface GovIdPhoto {
  /** "FRONT" or "BACK", taken from the label the photo was stored under. */
  readonly side: string;
  /** A signed link that lapses in five minutes (CLAUDE.md §2.8). */
  readonly url: string;
}

/**
 * The photographs of a member's government ID (ADR-074).
 *
 * A thumbnail cannot be read, so each opens full size in its own tab; the link is
 * signed and short-lived, so it cannot be passed on or bookmarked. The gym holds no
 * ID number, here or anywhere: the picture is the whole record.
 *
 * Used by the verify queue, where staff decide, and by the member's profile, where
 * the same photographs would otherwise be stored and never seen again (ADR-077).
 */
export function GovIdStrip({ type, photos }: { type: string | null; photos: readonly GovIdPhoto[] }) {
  const t = useTranslations('crm.verify');
  if (type === null || photos.length === 0) {
    return <p className="mt-4 text-small text-brand-stone">{t('govIdNone')}</p>;
  }
  const typeLabel = t(`govIdType.${type}` as never);
  return (
    <section className="mt-4">
      <p className="text-small font-semibold text-brand-stone">
        {t('govId')}: <span className="text-brand-obsidian">{typeLabel}</span>
      </p>
      <ul className="mt-2 flex flex-wrap gap-3">
        {photos.map((photo) => {
          const alt = t('govIdAlt', { type: typeLabel, side: t(`govIdSide.${photo.side}` as never) });
          return (
            <li key={photo.side}>
              <a href={photo.url} target="_blank" rel="noreferrer" aria-label={alt} className="block rounded-panel focus-visible:outline-2 focus-visible:outline-offset-2">
                {/* A signed, short-lived URL to a private file: next/image would cache it. */}
                <img src={photo.url} alt={alt} className="h-24 w-36 rounded-panel border border-brand-stone/30 object-cover" />
              </a>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-small text-brand-stone">{t('govIdOpen')}</p>
    </section>
  );
}
