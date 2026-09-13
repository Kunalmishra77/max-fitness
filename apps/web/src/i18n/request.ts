import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { CRM_DEFAULT_LOCALE, LOCALE_COOKIE, routing } from './routing';

/**
 * Per-request i18n configuration.
 *
 * Messages are loaded from `messages/{locale}.json`. CLAUDE.md §2.9 forbids
 * hard-coded UI strings, so every visible string in the app resolves through here.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;

  // The CRM has no locale in its URL (CLAUDE.md §2.9), so there is nothing for next-intl
  // to infer: without this, every CRM screen would render in the website's English
  // default while its `lang` attribute said Hindi. The cookie is the CRM's language.
  //
  // The website's pages are generated at build time, where there is no request and
  // reading a cookie throws. Guarding it is what lets one config serve both: a static
  // page has its locale in the URL and never needs the cookie.
  let fromCookie: string | undefined;
  try {
    fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  } catch {
    fromCookie = undefined;
  }
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : hasLocale(routing.locales, fromCookie)
      ? fromCookie
      : CRM_DEFAULT_LOCALE;

  return {
    locale,
    messages: ((await import(`../../messages/${locale}.json`)) as { default: Record<string, unknown> }).default,
    timeZone: 'Asia/Kolkata',
    // Formatting defaults so a date or amount rendered without explicit options
    // still comes out in Indian conventions (TRD §6 Localisation).
    formats: {
      dateTime: {
        short: { day: 'numeric', month: 'short', year: 'numeric' },
      },
      number: {
        inr: { style: 'currency', currency: 'INR', maximumFractionDigits: 0 },
      },
    },
  };
});
