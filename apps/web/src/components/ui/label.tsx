'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';

/**
 * Label.
 *
 * Radix's Label handles the click-to-focus association, including for custom
 * controls where a plain `<label for>` would not work.
 */
export function Label({ className, ...props }: ComponentPropsWithoutRef<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        'mb-1.5 block text-[length:var(--text-body)] font-medium text-[var(--color-brand-ink)]',
        'peer-disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}
