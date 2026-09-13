import { defineRouting } from 'next-intl/routing';

/**
 * Locale routing (CLAUDE.md §2.9).
 *
 * The public website defaults to English with a Hindi toggle; the CRM defaults to
 * Hindi with an English toggle. They are different audiences — a prospect
 * arriving from Google Maps, and an owner who left school after fifth standard
 * (project-analysis §1) — so they get different defaults.
 *
 * That split is why only the public routes carry a `[locale]` segment. The CRM
 * lives outside it and reads a cookie instead: a member of staff should not be
 * able to land on the wrong-language CRM by pasting a URL.
 */
export const routing = defineRouting({
  locales: ['en', 'hi'],
  defaultLocale: 'en',
  // `/` and `/hi`, not `/en` and `/hi`. The English URL is the canonical one for SEO.
  localePrefix: 'as-needed',
});

export type Locale = (typeof routing.locales)[number];

/** The CRM's default, which differs from the website's (CLAUDE.md §2.9). */
export const CRM_DEFAULT_LOCALE: Locale = 'hi';

export const LOCALE_COOKIE = 'MFP_LOCALE';

export function isLocale(value: string): value is Locale {
  return (routing.locales as readonly string[]).includes(value);
}
