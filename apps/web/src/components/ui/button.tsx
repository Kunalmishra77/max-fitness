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
    'inline-flex items-center justify-center gap-2 rounded-button text-center',
    'font-body font-semibold whitespace-nowrap',
    'transition-colors duration-[var(--duration-fast)] ease-standard',
    'disabled:pointer-events-none disabled:opacity-50',
    'focus-visible:outline-offset-2',
  ),
  {
    variants: {
      variant: {
        primary: 'bg-brand-signboard-red text-brand-white hover:bg-brand-signboard-red-text',
        secondary: 'bg-brand-plate-navy text-brand-chalk hover:bg-brand-ink',
        /** 2px Chalk border, for Plate Navy and video backgrounds. */
        outlineLight: 'border-2 border-brand-chalk bg-transparent text-brand-chalk hover:bg-brand-chalk/10',
        /** 2px Plate Navy border, for Chalk and White backgrounds. */
        outlineDark: 'border-2 border-brand-plate-navy bg-transparent text-brand-plate-navy hover:bg-brand-plate-navy/[0.06]',
        outline: cn(
          'border border-brand-rubber-grey/40 bg-transparent',
          'text-brand-ink hover:bg-brand-rubber-grey/10',
        ),
        ghost: 'bg-transparent text-brand-ink hover:bg-brand-rubber-grey/10',
        link: 'bg-transparent text-brand-wall-blue underline underline-offset-4 hover:no-underline',
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
