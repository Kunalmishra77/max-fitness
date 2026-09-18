'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Dialog and Sheet.
 *
 * Two presentations of one Radix primitive, because they suit different jobs:
 * a centred **Dialog** for a confirmation, and a bottom **Sheet** for anything
 * with content to scroll. On a phone a bottom sheet starts within thumb reach
 * instead of in the middle of the screen — which matters for the CRM, where staff
 * work one-handed at a busy reception desk (crm-ux-blueprint).
 *
 * Radix supplies the parts that are easy to get wrong: focus trapping, restoring
 * focus on close, Escape, scroll locking, and `aria-modal`.
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

function Overlay({ className, ...props }: ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        'fixed inset-0 z-50 bg-[var(--color-brand-obsidian)]/50',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        className,
      )}
      {...props}
    />
  );
}

/** Centred modal. Use for a short confirmation, not for a form with many fields. */
export function DialogContent({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { children: ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2',
          'rounded-[var(--radius-modal)] bg-white p-6 shadow-[var(--shadow-overlay)]',
          'focus:outline-none',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Bottom sheet. The default for anything with scrollable content on a phone. */
export function SheetContent({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { children: ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto',
          'rounded-t-[var(--radius-modal)] bg-white p-6 shadow-[var(--shadow-overlay)]',
          // Keep clear of the home indicator on a modern phone.
          'pb-[max(1.5rem,env(safe-area-inset-bottom))]',
          'focus:outline-none',
          className,
        )}
        {...props}
      >
        <div
          aria-hidden
          className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--color-brand-stone)]/30"
        />
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;
