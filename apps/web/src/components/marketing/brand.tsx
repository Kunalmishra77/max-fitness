import { cn } from '@/lib/cn';
import { DumbbellIcon, StarIcon } from './icons';

/**
 * Brand primitives shared by several sections.
 */

/**
 * The gym's logo with its name beside it (ADR-061).
 *
 * The logo (assets/brand/max-gym-logo.png) says "MAX GYM"; the name beside it keeps the
 * full "Max Fitness Gym" for people and search engines. The image is decorative: the
 * words next to it, or the link around it, carry the name.
 */
export function Wordmark({ tone = 'light', className }: { tone?: 'light' | 'dark'; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-3', className)}>
      <img
        src="/brand/logo-96.webp"
        srcSet="/brand/logo-96.webp 1x, /brand/logo-192.webp 2x"
        alt=""
        width={99}
        height={96}
        decoding="async"
        className="h-12 w-auto"
      />
      <span className="font-display leading-none font-bold uppercase">
        <span className={cn('text-[1.5rem] tracking-[0.04em]', tone === 'light' ? 'text-brand-white' : 'text-brand-obsidian')}>Max Fitness</span>
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
        // ADR-061: a dark plate with a red glow in the corner, not an empty grey box.
        tone === 'onNavy'
          ? 'border border-brand-paper/10 bg-[radial-gradient(circle_at_85%_15%,rgb(217_15_31/0.35),transparent_55%),linear-gradient(160deg,#1c1c21,#0a0a0b)] text-brand-paper/85'
          : 'border border-brand-obsidian/10 bg-[radial-gradient(circle_at_85%_15%,rgb(217_15_31/0.18),transparent_55%),linear-gradient(160deg,#ffffff,#ececee)] text-brand-obsidian/80',
        className,
      )}
    >
      <DumbbellIcon className="text-[3rem] text-brand-accent-glow" />
      <span className="px-4 text-center font-display text-title font-bold tracking-[0.06em] uppercase">{label}</span>
      <span className="px-4 text-center text-small font-medium tracking-[0.2em] uppercase opacity-70">{caption}</span>
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
        tone === 'onNavy' ? 'border-brand-paper/40 text-brand-paper' : 'border-brand-stone/40 text-brand-stone',
      )}
    >
      {children}
    </span>
  );
}
