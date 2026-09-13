'use client';

import * as ToastPrimitive from '@radix-ui/react-toast';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Toast.
 *
 * The CRM's undo affordance lives here: crm-ux-blueprint gives destructive
 * actions a 10-second undo window (`--duration-undo`) rather than a confirmation
 * dialog, because an owner tapping quickly should not have to answer "are you
 * sure?" thirty times a day. The toast is how they get that second chance.
 *
 * Radix's Toast handles the parts that make a toast accessible rather than merely
 * visible: a live region that announces without stealing focus, F8 to jump to the
 * toast, and pausing the timer while the pointer is over it.
 */

export const ToastProvider = ToastPrimitive.Provider;
export const ToastTitle = ToastPrimitive.Title;
export const ToastDescription = ToastPrimitive.Description;
export const ToastAction = ToastPrimitive.Action;
export const ToastClose = ToastPrimitive.Close;

const toastVariants = cva(
  cn(
    'pointer-events-auto flex w-full items-start gap-3 rounded-[var(--radius-panel)] p-4',
    'shadow-[var(--shadow-overlay)]',
    'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-full',
    'data-[state=closed]:animate-out data-[state=closed]:fade-out-80',
  ),
  {
    variants: {
      tone: {
        neutral: 'bg-[var(--color-brand-plate-navy)] text-[var(--color-brand-chalk)]',
        success:
          'bg-[var(--color-tint-fee-paid-bg)] text-[var(--color-brand-ink)] border border-[var(--color-semantic-fee-paid)]/30',
        warning:
          'bg-[var(--color-tint-fee-due-soon-bg)] text-[var(--color-brand-ink)] border border-[var(--color-semantic-fee-due-soon)]/30',
        error:
          'bg-[var(--color-tint-fee-expired-bg)] text-[var(--color-brand-ink)] border border-[var(--color-semantic-fee-expired)]/30',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface ToastProps
  extends ComponentPropsWithoutRef<typeof ToastPrimitive.Root>,
    VariantProps<typeof toastVariants> {
  children?: ReactNode;
}

export function Toast({ className, tone, ...props }: ToastProps) {
  return <ToastPrimitive.Root className={cn(toastVariants({ tone }), className)} {...props} />;
}

/**
 * Where toasts appear.
 *
 * Bottom on a phone, so a toast never covers the header a member is reading and
 * an Undo button lands under the thumb; top-right from tablet up, where the
 * bottom edge is far from both.
 */
export function ToastViewport({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>) {
  return (
    <ToastPrimitive.Viewport
      className={cn(
        'pointer-events-none fixed z-[100] flex max-h-screen w-full flex-col gap-2 p-4',
        'bottom-0 left-0 pb-[max(1rem,env(safe-area-inset-bottom))]',
        'sm:bottom-auto sm:left-auto sm:right-0 sm:top-0 sm:max-w-sm',
        className,
      )}
      {...props}
    />
  );
}

/** The undo window from crm-ux-blueprint, in milliseconds. */
export const UNDO_DURATION_MS = 10_000;
