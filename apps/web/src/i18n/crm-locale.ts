import { cookies } from 'next/headers';
import { CRM_DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from './routing';

/**
 * The CRM's language (CLAUDE.md §2.9).
 *
 * The CRM has no locale in its URL: staff should not land on the wrong-language
 * CRM by opening a shared link. The choice lives in a cookie, and when there is
 * none the CRM opens in Hindi — the owner's language — rather than the website's
 * English default.
 *
 * The CRM screens arrive in Phase 4; this is the Phase 1 mechanism they will use.
 */
export async function getCrmLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return value !== undefined && isLocale(value) ? value : CRM_DEFAULT_LOCALE;
}
