'use client';

import { useEffect, useRef } from 'react';

/**
 * Make the phone's own Back button walk back through a multi-step form (MEM-005).
 *
 * Both QR forms held the current step in plain `useState` with no history entry, so on
 * Android — where the back gesture *is* how people navigate — a member on step 5 of 8 who
 * swiped back left the form entirely and lost every answer, **including the selfie and
 * the photographs of their ID card they had just taken**, standing at a reception desk
 * with a queue behind them. There is an in-page Back button, which does not help somebody
 * who used the one on their phone.
 *
 * The fix is one `history.pushState` per forward step and a `popstate` listener that moves
 * the step back instead of letting the page unload. Nothing is stored: the form's state
 * stays exactly where it was in memory, so the photographs survive because the component
 * never unmounts.
 *
 * **A refresh still clears the form, and that is deliberate.** The website's sign-up keeps
 * its progress in `sessionStorage` (`join-state.ts`) because it runs on the member's own
 * phone and holds no identity documents. This form runs on the gym's phone at the
 * counter, passed from member to member, and holds a photograph of somebody's Aadhaar
 * card. A part-filled form reappearing for the next person is a worse failure than
 * retyping a name, so what this fixes is navigation — the common case, and the one that
 * was losing work — rather than persistence.
 *
 * The entries carry a marker so a `popstate` from somewhere else in the history is left
 * alone, and `step 0` is deliberately not trapped: Back from the first screen should
 * leave the form, because by then the member means it.
 */

const MARKER = 'mfp-step';

export function useStepHistory(step: number, onBack: (previous: number) => void): void {
  /**
   * The listener is registered once and reads the step through a ref.
   *
   * Re-registering on every step change would mean a `popstate` arriving mid-update
   * reaching a listener that is about to be torn down — and a dropped back gesture is
   * exactly the bug this hook exists to fix.
   */
  const current = useRef(step);
  const onBackRef = useRef(onBack);
  const deepest = useRef(step);

  current.current = step;
  onBackRef.current = onBack;

  useEffect(() => {
    const handler = (event: PopStateEvent) => {
      const state = event.state as { [MARKER]?: number } | null;
      // Not one of ours: let the browser do whatever it was going to do.
      if (state === null || typeof state[MARKER] !== 'number') return;
      if (current.current <= 0) return;
      onBackRef.current(state[MARKER]);
    };

    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  useEffect(() => {
    // Only a step forward adds an entry. Going back consumes one, and pushing another
    // there would need two taps to leave a screen the member has already left once.
    if (step > deepest.current) {
      deepest.current = step;
      window.history.pushState({ [MARKER]: step - 1 }, '');
      return;
    }
    deepest.current = step;
  }, [step]);
}
