/**
 * The only source of "now" in the system.
 *
 * CLAUDE.md §2.2: domain code must never call `new Date()`. Every service takes a
 * Clock, production wires `systemClock`, and tests wire `FakeClock` so a business
 * rule that depends on the date is deterministic (testing-strategy.md §2).
 */
export interface Clock {
  /** The current instant, in UTC. Convert to an IST calendar date with `todayIST`. */
  now(): Date;
}

/** The real clock. Wire this at the application boundary, never inside a rule. */
export const systemClock: Clock = {
  now(): Date {
    return new Date();
  },
};

/**
 * A clock that stands still until you move it. Tests only.
 *
 * ```ts
 * const clock = new FakeClock(ist('2026-09-10T19:00'));
 * expect(todayIST(clock)).toBe('2026-09-10');
 * ```
 */
export class FakeClock implements Clock {
  #instant: Date;

  constructor(instant: Date) {
    this.#instant = new Date(instant.getTime());
  }

  now(): Date {
    return new Date(this.#instant.getTime());
  }

  /** Jump to an absolute instant. */
  set(instant: Date): void {
    this.#instant = new Date(instant.getTime());
  }

  /** Move forward (or back, with a negative value) by whole milliseconds. */
  advanceMs(ms: number): void {
    this.#instant = new Date(this.#instant.getTime() + ms);
  }

  advanceMinutes(minutes: number): void {
    this.advanceMs(minutes * 60_000);
  }

  advanceHours(hours: number): void {
    this.advanceMs(hours * 3_600_000);
  }

  advanceDays(days: number): void {
    this.advanceMs(days * 86_400_000);
  }
}
