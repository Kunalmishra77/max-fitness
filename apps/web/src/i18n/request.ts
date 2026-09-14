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

  // Three cases, and only one of them may touch a cookie.
  //
  // 1. The website: the locale is in the URL. These pages are generated at build time,
  //    so reading a cookie here would turn a static page dynamic at runtime — Next
  //    answers that with a 500, which is what took the live landing page down when the
  //    cookie read was merely wrapped in try/catch.
  // 2. The CRM: no locale in the URL at all (CLAUDE.md §2.9), so the signed-in person's
  //    cookie decides, with Hindi as the default. These routes are dynamic already.
  // 3. Anything else under the locale segment (`/favicon.ico` and friends): not a real
  //    page, so the website's default locale, and no cookie.
  let locale: string;
  if (hasLocale(routing.locales, requested)) {
    locale = requested;
  } else if (requested === undefined) {
    const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
    locale = hasLocale(routing.locales, fromCookie) ? fromCookie : CRM_DEFAULT_LOCALE;
  } else {
    locale = routing.defaultLocale;
  }

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
