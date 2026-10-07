'use client';

import { useEffect, useRef } from 'react';

/**
 * Keep the reception phone's screen on while the check-in page is open.
 *
 * Without this the phone locks after half a minute, the camera stops, and the first member
 * through the door finds a black screen. Somebody then has to walk over and wake it, every
 * time — which is exactly the job this page was meant to remove.
 *
 * Two things make it awkward, and both are handled:
 *
 * **The lock is lost whenever the page is hidden** — the phone being locked by hand, another
 * app coming forward, the browser going to the background — and the browser does not give it
 * back by itself. So it is re-taken on every return to visibility.
 *
 * **It can only be requested from a visible page**, and some browsers also want a user
 * gesture first. A refusal is not an error worth showing anybody: the screen simply behaves
 * as it did before, and the page still works. The gym's fallback is the phone's own
 * display-timeout setting, which `docs/09-operations/face-attendance-setup.md` says to raise.
 */

interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

export function useScreenAwake(enabled: boolean): void {
  const lockRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const navigatorWithLock = navigator as Navigator & {
      wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
    };
    if (navigatorWithLock.wakeLock === undefined) return;

    let cancelled = false;

    const take = async () => {
      if (cancelled || document.visibilityState !== 'visible' || lockRef.current !== null) return;
      try {
        const sentinel = await navigatorWithLock.wakeLock!.request('screen');
        if (cancelled) {
          void sentinel.release();
          return;
        }
        lockRef.current = sentinel;
        // The browser drops it on its own terms; clearing the reference is what lets the
        // next visibility change take a fresh one rather than believing it still holds this.
        sentinel.addEventListener('release', () => {
          lockRef.current = null;
        });
      } catch {
        // Refused — no gesture yet, battery saver, an older browser. The page is unaffected.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void take();
    };

    void take();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void lockRef.current?.release().catch(() => undefined);
      lockRef.current = null;
    };
  }, [enabled]);
}
