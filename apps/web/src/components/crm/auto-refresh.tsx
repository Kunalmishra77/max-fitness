'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Keeping an open screen current (ADR-092).
 *
 * Reception leaves Max Register open all day on one tab, so the arrivals list and today's
 * numbers go stale while nobody touches them. This re-asks the server for the same screen
 * on a timer — a server-component refresh, so what the person has typed, opened or scrolled
 * to stays exactly as it was.
 *
 * It is deliberately not a websocket. The gym has one desk and a handful of staff; a
 * request every half minute from a tab somebody is actually looking at costs less than a
 * connection to keep alive, and it degrades to nothing on a bad line.
 *
 * Two rules keep it honest: **nothing happens while the tab is hidden** — a phone in a
 * pocket must not poll all night — and **it catches up the instant the tab is looked at
 * again**, which is the moment the stale number would otherwise be believed.
 */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      if (timer === null) timer = setInterval(() => router.refresh(), Math.max(5, seconds) * 1000);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stop();
        return;
      }
      // Coming back is itself the signal that what is on screen may be old.
      router.refresh();
      start();
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [router, seconds]);

  return null;
}
