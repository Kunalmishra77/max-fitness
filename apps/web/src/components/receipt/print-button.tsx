'use client';

import { buttonVariants } from '@/components/ui/button';

/** Prints the receipt page; print styles hide everything but the receipt itself. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonVariants({ variant: 'outlineDark' })}>
      {label}
    </button>
  );
}
