'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { CRM_CARD } from '@/components/crm/crm-chrome';
import { CrmIcon } from '@/components/crm/crm-icons';
import { cn } from '@/lib/cn';
import { fitWithin } from '@/components/join/fit-within';

/**
 * The gym's website photos, managed from the desk (ADR-091).
 *
 * The photo is shrunk **in the browser** before it is uploaded, for the same reason a member's
 * ID is: a phone photograph is four megabytes, the host refuses anything near that, and a gym
 * on a desk connection should not be made to wait for bytes nobody will ever see at that size.
 * The dimensions measured here travel with it, so the page can reserve the space.
 */

export type GalleryResult = { ok: true } | { ok: false; code: 'FORBIDDEN' | 'TOO_SMALL' | 'generic' };

export interface GalleryPhotoView {
  readonly id: string;
  readonly isPublished: boolean;
  readonly captionEn: string | null;
  readonly captionHi: string | null;
}

/** Long edge for a website photo: sharp on a laptop, small enough to load on 4G. */
const MAX_EDGE = 1600;
const TARGET_BYTES = 420 * 1024;

async function shrink(file: File): Promise<{ blob: Blob; width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const size = fitWithin(bitmap.width, bitmap.height, MAX_EDGE);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();

  for (const quality of [0.85, 0.7]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob !== null && (blob.size <= TARGET_BYTES || quality === 0.7)) return { blob, width: size.width, height: size.height };
  }
  return null;
}

export function GalleryManager({
  photos,
  add,
  remove,
  publish,
  move,
}: {
  readonly photos: readonly GalleryPhotoView[];
  readonly add: (form: FormData) => Promise<GalleryResult>;
  readonly remove: (id: string) => Promise<GalleryResult>;
  readonly publish: (id: string, isPublished: boolean) => Promise<GalleryResult>;
  readonly move: (id: string, direction: 'UP' | 'DOWN') => Promise<GalleryResult>;
}) {
  const t = useTranslations('crm.gallery');
  const input = useRef<HTMLInputElement | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, begin] = useTransition();

  const report = (result: GalleryResult) => {
    setFailure(result.ok ? null : t(`errors.${result.code}` as never));
  };

  const upload = async (files: FileList | null) => {
    if (files === null || files.length === 0) return;
    setBusy(true);
    setFailure(null);
    try {
      for (const file of Array.from(files).slice(0, 10)) {
        const shrunk = await shrink(file);
        if (shrunk === null) {
          setFailure(t('errors.couldNotRead'));
          continue;
        }
        const form = new FormData();
        form.set('photo', shrunk.blob, 'gallery.jpg');
        form.set('width', String(shrunk.width));
        form.set('height', String(shrunk.height));
        report(await add(form));
      }
    } finally {
      setBusy(false);
      if (input.current !== null) input.current.value = '';
    }
  };

  return (
    <div className="grid gap-3">
      <section className={cn(CRM_CARD, 'p-4')} aria-labelledby="gallery-add">
        <h2 id="gallery-add" className="text-crm-body font-bold text-brand-obsidian">
          {t('addTitle')}
        </h2>
        <p className="mt-1 text-small text-brand-stone">{t('addHelp')}</p>

        <label className="mt-3 flex min-h-20 cursor-pointer items-center justify-center gap-3 rounded-panel border-2 border-dashed border-brand-stone/40 px-4 text-crm-body font-semibold text-brand-obsidian hover:border-brand-accent">
          <CrmIcon name="plus" className="size-6" />
          {busy ? t('uploading') : t('choose')}
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            disabled={busy || pending}
            onChange={(event) => void upload(event.target.files)}
            className="sr-only"
          />
        </label>

        {failure === null ? null : (
          <p role="alert" className="mt-3 rounded-input bg-tint-fee-expired-bg p-3 text-crm-body font-semibold text-semantic-fee-expired">
            {failure}
          </p>
        )}
      </section>

      <section className={cn(CRM_CARD, 'p-4')} aria-labelledby="gallery-list">
        <h2 id="gallery-list" className="text-crm-body font-bold text-brand-obsidian">
          {t('listTitle')}
        </h2>
        {photos.length === 0 ? (
          <p className="mt-3 text-crm-body text-brand-stone">{t('empty')}</p>
        ) : (
          <>
            <p className="mt-1 text-small text-brand-stone">{t('listHelp')}</p>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {photos.map((photo, index) => (
                <li key={photo.id} className="overflow-hidden rounded-panel border border-brand-stone/20">
                  {/* Served by our own public route, so no signed URL and no next/image cache. */}
                  <img src={`/api/v1/gallery/${photo.id}`} alt="" className={cn('h-40 w-full object-cover', photo.isPublished ? '' : 'opacity-40')} />
                  <div className="flex flex-wrap items-center gap-2 p-2">
                    <button
                      type="button"
                      disabled={pending || index === 0}
                      onClick={() => begin(async () => report(await move(photo.id, 'UP')))}
                      aria-label={t('moveUp')}
                      className="size-11 rounded-button border-2 border-brand-stone/40 text-crm-body font-bold disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={pending || index === photos.length - 1}
                      onClick={() => begin(async () => report(await move(photo.id, 'DOWN')))}
                      aria-label={t('moveDown')}
                      className="size-11 rounded-button border-2 border-brand-stone/40 text-crm-body font-bold disabled:opacity-40"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => begin(async () => report(await publish(photo.id, !photo.isPublished)))}
                      className="min-h-11 flex-1 rounded-button border-2 border-brand-stone/40 px-2 text-small font-semibold text-brand-obsidian disabled:opacity-50"
                    >
                      {photo.isPublished ? t('hide') : t('show')}
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => begin(async () => report(await remove(photo.id)))}
                      className="min-h-11 rounded-button border-2 border-semantic-fee-expired px-3 text-small font-semibold text-semantic-fee-expired disabled:opacity-50"
                    >
                      {t('delete')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
