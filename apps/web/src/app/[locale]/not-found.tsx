import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

/**
 * The public site's 404 (U-1 / Phase 8).
 *
 * Reached by `notFound()` from the legal-page slug check, the QR reference check, and any
 * unmatched path inside a valid locale. The locale layout above it supplies `<html>`, the
 * fonts and the stylesheet, so this is a page rather than a document.
 *
 * It does not render `MarketingShell`. The shell needs a `SiteContext`, which is a
 * database read for the gym's phone number, hours and promo line — and a 404 that falls
 * over when the database is busy is worse than a plain one. Links go to the home page and
 * the contact page, which is the only navigation somebody on a dead link actually wants.
 */

export const metadata = { robots: { index: false, follow: false } };

export default async function LocaleNotFound() {
  const t = await getTranslations('errors.notFound');

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-brand-obsidian px-6 text-center text-brand-paper">
      <img src="/brand/logo-96.webp" alt="" width={99} height={96} className="h-14 w-auto" />
      <h1 className="font-display text-display-m leading-tight font-bold text-brand-white">{t('title')}</h1>
      <p className="max-w-[46ch] text-body leading-body text-brand-mist">{t('body')}</p>
      <div className="mt-4 grid w-full max-w-xs gap-3">
        <Link href="/" className="flex min-h-14 items-center justify-center rounded-button bg-brand-accent px-6 text-body font-semibold text-brand-white">
          {t('home')}
        </Link>
        <Link
          href="/contact"
          className="flex min-h-14 items-center justify-center rounded-button border-2 border-brand-paper/40 px-6 text-body font-semibold text-brand-paper"
        >
          {t('contact')}
        </Link>
      </div>
    </main>
  );
}
