'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

/**
 * The attendance screen's error boundary (U-1 / Phase 8).
 *
 * A member is standing in front of this phone, so the copy is two lines and tells them
 * the one thing they can do: say so at the desk. Attendance can always be marked by hand
 * from Max Register, which is what reception needs to hear.
 *
 * Deliberately large text and a 56px target: this is read standing up, at arm's length.
 */
export default function CheckInError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('errors.checkinError');

  useEffect(() => {
    console.error(`[checkin] screen failed: ${error.name}${error.digest === undefined ? '' : ` ${error.digest}`}`);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
      <h1 className="font-display text-display-l leading-tight font-bold text-brand-obsidian">{t('title')}</h1>
      <p className="max-w-[34ch] text-body-l leading-body text-brand-stone">{t('body')}</p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 flex min-h-16 w-full max-w-sm items-center justify-center rounded-button bg-brand-obsidian text-body-l font-bold text-white"
      >
        {t('retry')}
      </button>
    </main>
  );
}
