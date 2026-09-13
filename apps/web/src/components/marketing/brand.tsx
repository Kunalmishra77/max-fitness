import { cn } from '@/lib/cn';
import { DumbbellIcon, StarIcon } from './icons';

/**
 * Brand primitives shared by several sections.
 */

/**
 * Wordmark.
 *
 * assets/brand/README.md: with no vector logo from the gym yet, a clean wordmark
 * inspired by the signboard — bold "MAX" in Signboard Red with "FITNESS GYM" beneath,
 * in Khand 700. Placeholder until the owner approves a logo.
 */
export function Wordmark({ tone = 'light', className }: { tone?: 'light' | 'dark'; className?: string }) {
  return (
    <span className={cn('inline-flex flex-col font-display leading-none font-bold', className)}>
      <span className="text-[1.75rem] tracking-tight text-brand-signboard-red">MAX</span>
      <span
        className={cn(
          'text-[0.7rem] tracking-[0.18em]',
          tone === 'light' ? 'text-brand-chalk' : 'text-brand-plate-navy',
        )}
      >
        FITNESS GYM
      </span>
    </span>
  );
}

/**
 * Photo placeholder.
 *
 * Phase 2 rule: no stock photos of people. Until the shoot, each photo slot shows a
 * quiet tinted block with a dumbbell mark and the scene it will hold, and carries that
 * description as its accessible name. Same aspect ratio as the real photo, so
 * swapping it in causes no layout shift.
 */
export function PhotoPlaceholder({
  label,
  caption,
  tone,
  aspect = 'aspect-[4/3]',
  className,
}: {
  label: string;
  caption: string;
  tone: 'onNavy' | 'onChalk';
  aspect?: string;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        'relative flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-photo',
        aspect,
        // Caption opacity stays at 80%: lighter fails WCAG AA contrast on the tinted block.
        tone === 'onNavy'
          ? 'bg-brand-chalk/[0.07] text-brand-chalk/80'
          : 'bg-brand-plate-navy/[0.07] text-brand-plate-navy/80',
        className,
      )}
    >
      <DumbbellIcon className="text-[2.5rem]" />
      <span className="px-4 text-center text-small font-medium">{caption}</span>
    </div>
  );
}

/** A 1–5 star rating with the number set in Khand (DESIGN-BLUEPRINT §9 rating chip). */
export function Stars({ rating, label }: { rating: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={label}>
      <span className="font-display text-title leading-none font-bold">{rating}</span>
      {Array.from({ length: 5 }, (_, i) => (
        <StarIcon key={i} className={cn('text-[0.95rem]', i < rating ? 'text-brand-medal-gold' : 'opacity-25')} />
      ))}
    </span>
  );
}

/** A small label for demo or unconfirmed content, shown only where such content is allowed. */
export function ContentFlag({ children, tone }: { children: string; tone: 'onNavy' | 'onChalk' }) {
  return (
    <span
      className={cn(
        'inline-block rounded-button border px-2 py-0.5 text-small font-semibold',
        tone === 'onNavy' ? 'border-brand-chalk/40 text-brand-chalk' : 'border-brand-rubber-grey/40 text-brand-rubber-grey',
      )}
    >
      {children}
    </span>
  );
}
