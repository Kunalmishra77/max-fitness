'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

/**
 * Max Register's error boundary (U-1 / Phase 8).
 *
 * The screen this replaces mattered more than any other. Every CRM route is
 * `force-dynamic` and reads Supabase, and `currentActor()` already wraps its session
 * lookup in `withOneRetry` *because* a passing database hiccup is expected. That retry
 * covers one read; every other read on every other screen had no net, so the owner's
 * daily tool could answer a busy reception desk with an English stack-trace page.
 *
 * So the first line of the copy is the one reception needs: **nothing was saved**. A
 * half-finished fee entry is the fear, and the answer is that a failed render wrote
 * nothing.
 *
 * `reset()` re-runs the segment, which is the right first move for a transient timeout.
 */
export default function CrmError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('errors.crmError');

  useEffect(() => {
    console.error(`[crm] screen failed: ${error.name}${error.digest === undefined ? '' : ` ${error.digest}`}`);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-display-m font-bold text-brand-obsidian">{t('title')}</h1>
      <p className="max-w-[46ch] text-crm-body text-brand-stone">{t('body')}</p>
      <div className="mt-2 grid w-full max-w-xs gap-3">
        <button type="button" onClick={reset} className="flex min-h-14 items-center justify-center rounded-button bg-brand-obsidian text-crm-body font-bold text-white">
          {t('retry')}
        </button>
        {/* A full navigation, not a router push: the router may be part of what failed. */}
        <a href="/crm" className="flex min-h-14 items-center justify-center rounded-button border-2 border-brand-obsidian text-crm-body font-bold text-brand-obsidian">
          {t('home')}
        </a>
      </div>
      {error.digest === undefined ? null : <p className="mt-1 text-small text-brand-stone/70">{t('reference', { digest: error.digest })}</p>}
    </main>
  );
}
