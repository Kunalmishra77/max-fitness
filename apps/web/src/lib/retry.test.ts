import { describe, expect, it } from 'vitest';
import { withOneRetry } from './retry';

/**
 * One more try for a lookup that failed (progress log 2026-09-12: a passing database
 * hiccup signed staff out mid-work, because the session lookup's error became "no
 * session" and sent them to the login screen).
 *
 * A failure is retried once. An answer — including `null`, "there is no session" — is
 * never retried: retrying it would only make a signed-out person wait twice as long.
 */

/** Work that fails the first `failures` times, then answers `value`. */
function flaky<T>(failures: number, value: T) {
  let calls = 0;
  const work = () => {
    calls += 1;
    return calls <= failures ? Promise.reject(new Error(`attempt ${calls} failed`)) : Promise.resolve(value);
  };
  return { work, calls: () => calls };
}

describe('withOneRetry', () => {
  it('returns the answer without trying again', async () => {
    const lookup = flaky(0, 'actor');
    await expect(withOneRetry(lookup.work)).resolves.toBe('actor');
    expect(lookup.calls()).toBe(1);
  });

  it('tries once more after a failure, so a passing hiccup does not sign anyone out', async () => {
    const lookup = flaky(1, 'actor');
    await expect(withOneRetry(lookup.work)).resolves.toBe('actor');
    expect(lookup.calls()).toBe(2);
  });

  it('gives up after the second failure, with that failure', async () => {
    const lookup = flaky(5, 'actor');
    await expect(withOneRetry(lookup.work)).rejects.toThrow('attempt 2 failed');
    expect(lookup.calls()).toBe(2);
  });

  it('does not retry "no session": that is an answer, not a failure', async () => {
    const lookup = flaky(0, null);
    await expect(withOneRetry(lookup.work)).resolves.toBeNull();
    expect(lookup.calls()).toBe(1);
  });
});
