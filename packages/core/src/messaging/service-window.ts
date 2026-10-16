/**
 * Meta's 24-hour customer service window (ADR-127).
 *
 * A business may write what it likes to somebody who wrote to it first, for 24 hours
 * from their message. After that only an approved template may be sent, and free text
 * is rejected by the Graph API — a refusal the member never sees and reception has no
 * way to understand from the error code.
 *
 * So the composer asks this before it lets anybody type, and says how long is left.
 * Reception's question at the desk is *"can I just answer them?"*, and the honest
 * answers are "yes, for another four hours" or "no — send a template instead".
 *
 * **It is written here rather than in the route** because the rule is Meta's, not ours:
 * the same twenty-four hours decide what the screen offers and what the sender allows,
 * and those two disagreeing would mean a reply box that produces a failure.
 */

/** Twenty-four hours, in milliseconds. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ServiceWindow {
  readonly open: boolean;
  /** Whole minutes of free-text time left. `0` whenever the window is shut. */
  readonly minutesLeft: number;
}

const SHUT: ServiceWindow = { open: false, minutesLeft: 0 };

/**
 * @param lastInboundAt when the member last wrote, or `null` if they never have.
 * @param now injected, never read from the clock here (CLAUDE.md §2.2).
 */
export function serviceWindow(lastInboundAt: Date | null, now: Date): ServiceWindow {
  if (lastInboundAt === null) return SHUT;

  const since = now.getTime() - lastInboundAt.getTime();
  /**
   * A message dated in the future is a clock disagreeing with the provider's, not a
   * fresh window. Treating it as open would offer reception a reply Meta has already
   * shut the door on, so the benefit of the doubt goes the other way.
   */
  if (since < 0 || since >= WINDOW_MS) return SHUT;

  return { open: true, minutesLeft: Math.floor((WINDOW_MS - since) / 60_000) };
}
