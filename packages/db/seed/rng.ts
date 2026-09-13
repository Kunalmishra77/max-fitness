/**
 * Deterministic pseudo-random numbers for the seed.
 *
 * demo-data-seed-spec.md fixes the RNG seed at 20260910 so that
 * `SEED_TODAY=2026-09-10 pnpm db:seed` reproduces the same database every time —
 * which is what makes screenshots stable and a "the demo looked different
 * yesterday" bug report investigable.
 *
 * This is a mulberry32 generator: 32-bit state, one multiply and a few shifts,
 * and it passes the randomness tests that matter for generating plausible gym
 * attendance. It is written out rather than pulled from npm because it is fifteen
 * lines and a dependency here would be a dependency in the lockfile forever.
 *
 * Not for anything security-related — tokens and keys use `node:crypto`.
 */
export class Rng {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }

  /** Integer in [min, max], inclusive at both ends. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) {
      throw new Error('Cannot pick from an empty array');
    }
    return item;
  }

  /**
   * Pick by weight: `weighted([['CASH', 45], ['UPI_DIRECT', 35], ...])`.
   * Used for the payment-method and attendance-method mixes in the seed spec.
   */
  weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T {
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = this.next() * total;
    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll < 0) return value;
    }
    const last = entries[entries.length - 1];
    if (last === undefined) {
      throw new Error('Cannot pick from an empty weighted list');
    }
    return last[0];
  }

  /** Fisher-Yates, in place, using this generator so shuffles are reproducible too. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      const a = items[i];
      const b = items[j];
      if (a !== undefined && b !== undefined) {
        items[i] = b;
        items[j] = a;
      }
    }
    return items;
  }

  /**
   * Approximately normal, via the sum of three uniforms (Bates distribution),
   * clamped to ±3σ. Used for face-match scores, which the spec puts at N(0.72, 0.05):
   * a uniform spread would look obviously synthetic on the attendance screen.
   */
  normal(mean: number, stdDev: number): number {
    const u = (this.next() + this.next() + this.next()) / 3;
    // The mean of three uniforms has σ = 1/6, so scale by 6 to get unit variance.
    const z = (u - 0.5) * 6;
    return mean + Math.max(-3, Math.min(3, z)) * stdDev;
  }
}

/** The seed value fixed by demo-data-seed-spec.md. */
export const DEMO_RNG_SEED = 20_260_910;
