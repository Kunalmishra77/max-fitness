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
 *
 * ADR-061: the content rises into place as it scrolls in (`reveal-up`, CSS only, off with
 * reduced motion), and headings carry a small red eyebrow and the logo's capitals.
 */

export type SectionTone = 'navy' | 'chalk' | 'white' | 'red';

const TONE: Record<SectionTone, string> = {
  navy: 'bg-brand-obsidian text-brand-paper',
  chalk: 'bg-brand-paper text-brand-ink',
  white: 'bg-brand-white text-brand-ink',
  red: 'bg-brand-accent text-brand-white',
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
          density === 'regular' ? 'reveal-up py-20 md:py-28' : 'py-4 md:py-5',
        )}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * Section headline in the logo's capitals, with a short red eyebrow above it (ADR-061).
 * `onDark` picks the eyebrow red that keeps 4.5:1 on obsidian.
 */
export function SectionHeading({
  id,
  children,
  className,
  eyebrow,
  onDark = false,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  eyebrow?: string;
  onDark?: boolean;
}) {
  return (
    <div>
      {eyebrow === undefined ? null : <Eyebrow onDark={onDark}>{eyebrow}</Eyebrow>}
      <h2
        id={id}
        className={cn('mt-4 max-w-[20ch] font-display text-display-l leading-display font-bold tracking-[0.01em] uppercase', className)}
      >
        {children}
      </h2>
    </div>
  );
}

/** A red rule and a small spaced label, above a headline. */
export function Eyebrow({ children, onDark = false }: { children: ReactNode; onDark?: boolean }) {
  return (
    <p
      className={cn(
        'flex items-center gap-3 text-small font-semibold tracking-[0.28em] uppercase',
        onDark ? 'text-brand-accent-glow' : 'text-brand-accent-deep',
      )}
    >
      <span aria-hidden className="h-0.5 w-10 bg-current" />
      {children}
    </p>
  );
}
