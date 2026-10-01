'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

/**
 * A photograph or an ID, opened where the member's record is (ADR-086).
 *
 * These used to be `<a target="_blank">`: staff tapped a member's Aadhaar and lost the
 * profile behind a new tab, then had to find their way back. At a desk with somebody
 * waiting, that is the difference between a glance and an interruption.
 *
 * A PDF cannot be shown inside the page, so for one the dialog offers the link rather
 * than pretending — the member's own file, opened deliberately, in its own tab.
 */
export function PhotoViewer({
  url,
  alt,
  isFile = false,
  children,
}: {
  readonly url: string;
  readonly alt: string;
  /** True for a document the browser cannot render inline, such as a DigiLocker PDF. */
  readonly isFile?: boolean;
  /** The thumbnail or avatar that opens it. */
  readonly children: ReactNode;
}) {
  const t = useTranslations('crm.verify');
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={alt} className="block cursor-pointer rounded-panel focus-visible:outline-2 focus-visible:outline-offset-2">
        {children}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogTitle className="text-crm-body font-bold text-brand-obsidian">{alt}</DialogTitle>
          {isFile ? (
            <a href={url} target="_blank" rel="noreferrer" className="mt-4 block cursor-pointer rounded-panel bg-tint-fee-none-bg p-8 text-center text-crm-body font-semibold text-brand-obsidian">
              <span aria-hidden className="block text-4xl leading-none">📄</span>
              <span className="mt-2 block">{t('govIdOpenFile')}</span>
            </a>
          ) : (
            // A signed, short-lived URL to a private file: next/image would cache it.
            <img src={url} alt={alt} className="mt-4 max-h-[70vh] w-full rounded-panel object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
