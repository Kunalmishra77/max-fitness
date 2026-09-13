'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Dialog, DialogClose, DialogTitle, SheetContent } from '@/components/ui/dialog';
import { useRouter } from '@/i18n/navigation';

/**
 * Sign-up as a modal over the page it was opened from (wireframes "Sign-up modal").
 *
 * Rendered by the intercepted routes: tapping "Sign up" on the landing page opens this
 * without leaving the page, while the same URL opened directly, refreshed or shared
 * renders the full page. Closing goes back, so the landing page is restored where the
 * member left it.
 */
export function JoinModal({ step, children }: { step?: 1 | 2 | 3; children: ReactNode }) {
  const t = useTranslations('signup');
  const router = useRouter();
  const names = { 1: t('steps.details'), 2: t('steps.plan'), 3: t('steps.pay') } as const;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) router.back();
      }}
    >
      <SheetContent
        aria-describedby={undefined}
        className="mx-auto max-h-[92dvh] max-w-xl md:top-1/2 md:bottom-auto md:-translate-y-1/2 md:rounded-[var(--radius-modal)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            {/* The confirmation brings its own heading, so the sheet only needs a label. */}
            <DialogTitle className={step === undefined ? 'sr-only' : 'font-display text-display-m leading-tight font-bold text-brand-plate-navy'}>
              {t('title')}
            </DialogTitle>
            {step === undefined ? null : <p className="mt-1 text-body font-semibold text-brand-rubber-grey">{t('stepper', { step, name: names[step] })}</p>}
          </div>
          <DialogClose className={buttonVariants({ variant: 'ghost', size: 'icon' })} aria-label={t('camera.close')}>
            <span aria-hidden className="text-2xl leading-none">
              ×
            </span>
          </DialogClose>
        </div>
        {step === undefined ? null : (
          <ol aria-hidden className="mt-3 grid grid-cols-3 gap-2">
            {[1, 2, 3].map((n) => (
              <li key={n} className={n <= step ? 'h-1.5 rounded-full bg-brand-signboard-red' : 'h-1.5 rounded-full bg-brand-rubber-grey/30'} />
            ))}
          </ol>
        )}
        <div className={step === undefined ? 'mt-2' : 'mt-6'}>{children}</div>
      </SheetContent>
    </Dialog>
  );
}
