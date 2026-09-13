// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SlidingWindowLimiter, clientIp, limiterKey } from './rate-limit';

function limiter(limit: number, windowMs: number, maxKeys?: number) {
  let now = 1_000_000;
  const instance = new SlidingWindowLimiter({ limit, windowMs }, { now: () => now, ...(maxKeys === undefined ? {} : { maxKeys }) });
  return {
    instance,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('SlidingWindowLimiter', () => {
  it('allows up to the limit and counts down what remains', () => {
    const { instance } = limiter(3, 60_000);
    expect(instance.hit('a')).toEqual({ allowed: true, remaining: 2, retryAfterSeconds: 0 });
    expect(instance.hit('a').remaining).toBe(1);
    expect(instance.hit('a').remaining).toBe(0);
  });

  it('refuses the hit after the limit and says when to retry', () => {
    const { instance, advance } = limiter(2, 60_000);
    instance.hit('a');
    advance(10_000);
    instance.hit('a');
    advance(5_000);
    expect(instance.hit('a')).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 45 });
  });

  it('does not count refused hits, so waiting out the window always works', () => {
    const { instance, advance } = limiter(1, 60_000);
    instance.hit('a');
    for (let i = 0; i < 5; i++) {
      advance(10_000);
      expect(instance.hit('a').allowed).toBe(false);
    }
    advance(10_001);
    expect(instance.hit('a').allowed).toBe(true);
  });

  it('slides: old hits leave the window one by one', () => {
    const { instance, advance } = limiter(2, 60_000);
    instance.hit('a');
    advance(30_000);
    instance.hit('a');
    advance(30_001);
    expect(instance.hit('a').allowed).toBe(true);
    expect(instance.hit('a').allowed).toBe(false);
  });

  it('keeps separate buckets per key', () => {
    const { instance } = limiter(1, 60_000);
    expect(instance.hit('a').allowed).toBe(true);
    expect(instance.hit('b').allowed).toBe(true);
    expect(instance.hit('a').allowed).toBe(false);
  });

  it('evicts the least recently used key beyond its capacity', () => {
    const { instance } = limiter(1, 60_000, 2);
    instance.hit('a');
    instance.hit('b');
    instance.hit('c');
    expect(instance.size).toBe(2);
    // "a" was evicted, so it starts fresh.
    expect(instance.hit('a').allowed).toBe(true);
  });
});

describe('limiterKey', () => {
  it('is stable, scoped and does not contain the value', () => {
    const key = limiterKey('lead-mobile', '+919876543210');
    expect(key).toBe(limiterKey('lead-mobile', '+919876543210'));
    expect(key).not.toBe(limiterKey('lead-ip', '+919876543210'));
    expect(key).not.toContain('9876543210');
    expect(key).toHaveLength(32);
  });
});

describe('clientIp', () => {
  it('takes the left-most forwarded address', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip, then to "unknown"', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientIp(new Headers())).toBe('unknown');
  });
});
