import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Button.
 *
 * DESIGN-BLUEPRINT §3: red is for actions and prices, never decoration — so the
 * primary variant is the only red one, and a section should have one of them.
 * §9: secondary buttons are a 2px border on transparent — Chalk on dark sections,
 * Plate Navy on light ones — and labels say what happens ("Request a call back").
 *
 * Sizes follow the audience (design-tokens.json `size`, CLAUDE.md §2.10):
 * - `web` 48px — a prospect on a phone (tap target ≥ 44px).
 * - `hero` 56px — the hero's primary actions.
 * - `crm` 56px, `crmPrimary` 64px — reception staff working fast.
 * - `kiosk` 72px — a member mid-workout, at arm's length.
 *
 * For links, apply `buttonVariants()` to the link element directly.
 */
const buttonVariants = cva(
  cn(
    'relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-button text-center',
    'font-body font-semibold whitespace-nowrap',
    'transition-[color,background-color,border-color,transform,box-shadow] duration-[var(--duration-base)] ease-standard',
    'active:translate-y-0',
    'disabled:pointer-events-none disabled:opacity-50',
    'focus-visible:outline-offset-2',
  ),
  {
    variants: {
      variant: {
        // ADR-061: red lifts, glows and catches a light sweep on hover.
        primary: cn(
          'btn-shine bg-brand-accent text-brand-white shadow-[0_10px_28px_-14px_rgb(217_15_31/0.9)]',
          'hover:-translate-y-0.5 hover:bg-brand-accent-deep hover:shadow-[0_16px_34px_-14px_rgb(217_15_31/0.95)]',
        ),
        secondary: 'bg-brand-obsidian text-brand-paper hover:bg-brand-ink',
        /** 2px Chalk border, for Plate Navy and video backgrounds. */
        outlineLight: 'border-2 border-brand-paper/80 bg-transparent text-brand-paper hover:-translate-y-0.5 hover:border-brand-white hover:bg-brand-white hover:text-brand-obsidian',
        /** 2px Plate Navy border, for Chalk and White backgrounds. */
        outlineDark: 'border-2 border-brand-obsidian bg-transparent text-brand-obsidian hover:-translate-y-0.5 hover:bg-brand-obsidian hover:text-brand-white',
        outline: cn(
          'border border-brand-stone/40 bg-transparent',
          'text-brand-ink hover:bg-brand-stone/10',
        ),
        ghost: 'bg-transparent text-brand-ink hover:bg-brand-stone/10',
        link: 'bg-transparent text-brand-link underline underline-offset-4 hover:no-underline',
      },
      size: {
        web: 'min-h-12 px-5 text-body',
        hero: 'min-h-[var(--size-button-hero)] px-7 text-body-l',
        crm: 'min-h-[var(--size-tap-crm)] px-6 text-crm-body',
        crmPrimary: 'min-h-[var(--size-tap-crm-primary)] px-7 text-crm-body',
        kiosk: 'min-h-[var(--size-tap-kiosk)] px-8 text-body-l',
        icon: 'size-11 px-0',
      },
      full: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: { variant: 'primary', size: 'web', full: false },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render as the child element instead of a `<button>`. */
  asChild?: boolean;
  children?: ReactNode;
}

export function Button({ className, variant, size, full, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return <Component className={cn(buttonVariants({ variant, size, full }), className)} {...props} />;
}

export { buttonVariants };
