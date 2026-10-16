'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

/**
 * The public site's error boundary (U-1 / Phase 8).
 *
 * Before this existed, a throw anywhere in a public server component — a slow Supabase
 * read behind the fee board, a gym row that would not load — put a visitor on Next's
 * built-in page: unstyled, English, "Application error: a server-side exception has
 * occurred". On a site whose whole job is turning a Maps tap into a sign-up, that is the
 * end of the visit.
 *
 * `reset()` re-renders the segment rather than reloading, so a passing failure costs one
 * tap. The digest is Next's own correlation id — safe to show, and the only thing a
 * visitor can usefully quote on the phone. It is never the error message: that can carry
 * a connection string.
 */
export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('errors.serverError');

  useEffect(() => {
    // The class name and the digest only — never the message (CLAUDE.md §2.8).
    console.error(`[public] render failed: ${error.name}${error.digest === undefined ? '' : ` ${error.digest}`}`);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-brand-obsidian px-6 text-center text-brand-paper">
      <img src="/brand/logo-96.webp" alt="" width={99} height={96} className="h-14 w-auto" />
      <h1 className="font-display text-display-m leading-tight font-bold text-brand-white">{t('title')}</h1>
      <p className="max-w-[46ch] text-body leading-body text-brand-mist">{t('body')}</p>
      <div className="mt-4 grid w-full max-w-xs gap-3">
        <button type="button" onClick={reset} className="flex min-h-14 items-center justify-center rounded-button bg-brand-accent px-6 text-body font-semibold text-brand-white">
          {t('retry')}
        </button>
        <a href="/" className="flex min-h-14 items-center justify-center rounded-button border-2 border-brand-paper/40 px-6 text-body font-semibold text-brand-paper">
          {t('home')}
        </a>
      </div>
      {error.digest === undefined ? null : <p className="mt-2 text-small text-brand-mist/70">{t('reference', { digest: error.digest })}</p>}
    </main>
  );
}
