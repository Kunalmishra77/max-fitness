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

/**
 * SEC-002. The old behaviour — take the left-most `X-Forwarded-For` entry — read a value
 * the client chose, so every IP limiter in the application could be bypassed by sending a
 * different one each time. These tests are written from the attacker's side first,
 * because the fix is only worth anything if the spoof fails.
 */
describe('clientIp — a spoofed forwarded header', () => {
  /** Coolify's proxy appends the real peer, so a client's own claim ends up on the left. */
  const spoofed = (claim: string, real: string) => new Headers({ 'x-forwarded-for': `${claim}, ${real}` });

  it('ignores what the client claimed and uses what the proxy appended', () => {
    expect(clientIp(spoofed('203.0.113.9', '198.51.100.2'), 1)).toBe('198.51.100.2');
  });

  it('gives a rotating claim the same bucket every time', () => {
    const keys = ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4'].map((claim) => clientIp(spoofed(claim, '198.51.100.2'), 1));
    expect(new Set(keys).size).toBe(1);
  });

  it('is not fooled by a claim that is itself a list', () => {
    const headers = new Headers({ 'x-forwarded-for': '9.9.9.9, 8.8.8.8, 7.7.7.7, 198.51.100.2' });
    expect(clientIp(headers, 1)).toBe('198.51.100.2');
  });
});

describe('clientIp — counting hops', () => {
  it('takes the last entry with one proxy in front', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 198.51.100.2' }), 1)).toBe('198.51.100.2');
  });

  it('takes the second-to-last with a CDN in front of the proxy', () => {
    // client → CDN → proxy → app: the CDN wrote the client, the proxy wrote the CDN.
    expect(clientIp(new Headers({ 'x-forwarded-for': 'spoof, 203.0.113.7, 10.0.0.9' }), 2)).toBe('203.0.113.7');
  });

  it('shares one bucket when the chain is shorter than the configured hops', () => {
    // Reaching the container directly, past the proxy that was supposed to be in front.
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7' }), 2)).toBe('unknown');
  });

  it('trusts nothing at all with no proxy configured', () => {
    // A developer's machine: the header is whatever curl was told to send.
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7' }), 0)).toBe('unknown');
    expect(clientIp(new Headers({ 'x-real-ip': '203.0.113.7' }), 0)).toBe('unknown');
  });
});

describe('clientIp — shapes an entry arrives in', () => {
  it('drops a port, so one address is not two buckets', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '198.51.100.2:41234' }), 1)).toBe('198.51.100.2');
  });

  it('unwraps a bracketed IPv6 address, with or without a port', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '[2001:db8::1]:443' }), 1)).toBe('2001:db8::1');
    expect(clientIp(new Headers({ 'x-forwarded-for': '[2001:db8::1]' }), 1)).toBe('2001:db8::1');
  });

  it('leaves a bare IPv6 address alone rather than cutting it at a colon', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '2001:db8::1' }), 1)).toBe('2001:db8::1');
  });

  it('treats one address in two cases as one bucket', () => {
    const upper = clientIp(new Headers({ 'x-forwarded-for': '[2001:DB8::1]' }), 1);
    const lower = clientIp(new Headers({ 'x-forwarded-for': '[2001:db8::1]' }), 1);
    expect(upper).toBe(lower);
  });

  it('skips blank entries rather than counting them as a hop', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, , 198.51.100.2' }), 1)).toBe('198.51.100.2');
  });

  it('falls back to x-real-ip when there is no chain, then to "unknown"', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.2' }), 1)).toBe('198.51.100.2');
    expect(clientIp(new Headers(), 1)).toBe('unknown');
  });
});

describe('refund — a success must not spend the brute-force budget (SEC-004)', () => {
  /**
   * The bug this prevents was found by running the CRM end-to-end suite against a real
   * database: it signs in for each test, spent the twenty-per-quarter-hour allowance, and
   * every later test was refused at the login screen. The gym has the same shape — all
   * its staff and the kiosk behind one broadband connection — so this was never only a
   * test problem.
   */
  it('lets an unlimited number of successful sign-ins through', () => {
    const limiter = new SlidingWindowLimiter({ limit: 3, windowMs: 60_000 });

    for (let i = 0; i < 50; i += 1) {
      expect(limiter.hit('ip').allowed, `attempt ${i}`).toBe(true);
      limiter.refund('ip');
    }
  });

  it('still refuses once the failures alone reach the limit', () => {
    const limiter = new SlidingWindowLimiter({ limit: 3, windowMs: 60_000 });

    // Two good sign-ins, refunded, then three failures that are not.
    limiter.hit('ip');
    limiter.refund('ip');
    limiter.hit('ip');
    limiter.refund('ip');
    expect(limiter.hit('ip').allowed).toBe(true);
    expect(limiter.hit('ip').allowed).toBe(true);
    expect(limiter.hit('ip').allowed).toBe(true);

    expect(limiter.hit('ip').allowed).toBe(false);
  });

  it('gives back only the newest hit, so one refund cannot cancel another request\u2019s', () => {
    const limiter = new SlidingWindowLimiter({ limit: 2, windowMs: 60_000 });

    limiter.hit('ip');
    limiter.hit('ip');
    limiter.refund('ip');

    // One hit remains, so exactly one more is allowed and the next is refused.
    expect(limiter.hit('ip').allowed).toBe(true);
    expect(limiter.hit('ip').allowed).toBe(false);
  });

  it('forgets a key entirely when its last hit is given back, rather than leaking it', () => {
    const limiter = new SlidingWindowLimiter({ limit: 5, windowMs: 60_000 });

    limiter.hit('ip');
    expect(limiter.size).toBe(1);
    limiter.refund('ip');
    expect(limiter.size).toBe(0);
  });

  it('does nothing for a key that was never counted', () => {
    const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 60_000 });

    expect(() => limiter.refund('never-seen')).not.toThrow();
    expect(limiter.hit('never-seen').allowed).toBe(true);
  });
});
