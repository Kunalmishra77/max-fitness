import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Input.
 *
 * 48px tall by default (design-tokens.json `size.inputHeight`) so a thumb can hit
 * it on a phone, which is where nearly every sign-up will happen. `aria-invalid`
 * drives the error styling rather than a separate prop, so the visual state and
 * the state screen readers announce cannot disagree.
 */
export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'block w-full rounded-[var(--radius-input)] border bg-white px-4',
        'min-h-[var(--size-input-height)] text-[length:var(--text-body)] text-[var(--color-brand-ink)]',
        'border-[var(--color-brand-rubber-grey)]/40 placeholder:text-[var(--color-brand-rubber-grey)]/70',
        'transition-colors duration-[var(--duration-fast)]',
        'disabled:cursor-not-allowed disabled:opacity-60',
        'aria-[invalid=true]:border-[var(--color-semantic-fee-expired)]',
        'aria-[invalid=true]:bg-[var(--color-tint-fee-expired-bg)]',
        className,
      )}
      {...props}
    />
  );
}
