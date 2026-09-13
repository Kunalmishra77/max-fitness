import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A landing-page section.
 *
 * DESIGN-BLUEPRINT §3 and §5: sections alternate Plate Navy and Chalk to create rhythm
 * without dividers, sit inside a 1200px content width with 20px mobile side padding,
 * and use 64px / 96px vertical padding. The tone sets background and text colour
 * together, so a section can never end up with navy text on navy.
 *
 * Regular sections use `deferred-render` (globals.css): the browser skips their style,
 * layout and paint until they near the viewport, which keeps first paint of a long page
 * fast on a slow phone (ADR-033). The thin trust strip sits just under the hero and is
 * always rendered.
 */

export type SectionTone = 'navy' | 'chalk' | 'white' | 'red';

const TONE: Record<SectionTone, string> = {
  navy: 'bg-brand-plate-navy text-brand-chalk',
  chalk: 'bg-brand-chalk text-brand-ink',
  white: 'bg-brand-white text-brand-ink',
  red: 'bg-brand-signboard-red text-brand-white',
};

export function Section({
  id,
  tone,
  labelledBy,
  density = 'regular',
  className,
  children,
}: {
  id?: string;
  tone: SectionTone;
  labelledBy?: string;
  density?: 'regular' | 'strip';
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      // Anchored sections stop below the sticky navigation instead of under it.
      className={cn('scroll-mt-20', TONE[tone], density === 'regular' && 'deferred-render', className)}
    >
      <div
        className={cn(
          'mx-auto max-w-[var(--size-content-max)] px-5 md:px-6',
          density === 'regular' ? 'py-16 md:py-24' : 'py-4 md:py-5',
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** Section headline: Khand, sentence case, no eyebrow label above it (DESIGN-BLUEPRINT §4). */
export function SectionHeading({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <h2 id={id} className={cn('max-w-[20ch] font-display text-display-l leading-display font-bold', className)}>
      {children}
    </h2>
  );
}
