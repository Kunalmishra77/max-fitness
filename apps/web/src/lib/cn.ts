import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Merge class names, letting a later Tailwind utility win over an earlier one in
 * the same group. Without this, `cn('p-2', 'p-4')` would emit both and the winner
 * would depend on stylesheet order (coding-standards.md §5: avoid conflicting
 * selectors).
 *
 * tailwind-merge must know the design-token scales from tokens.css. Otherwise it
 * reads an unknown `text-display-l` as a colour, decides it conflicts with
 * `text-brand-obsidian`, and silently drops one of them — headings lost their size
 * and red buttons lost their white text before this was configured.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['display-xl', 'display-l', 'display-m', 'title', 'body-l', 'body', 'small', 'crm-number', 'crm-body', 'kiosk-name'],
      leading: ['display', 'tight', 'ui', 'body', 'devanagari-boost'],
      radius: ['button', 'input', 'panel', 'modal', 'photo', 'avatar', 'crm-tile'],
      font: ['display', 'body'],
      ease: ['standard', 'enter'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
