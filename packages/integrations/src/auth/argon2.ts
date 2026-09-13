import { hash, verify } from '@node-rs/argon2';
import type { PinHasher } from '@mfp/core/ports';

/**
 * Argon2id PIN hashing (security-plan.md §3.1: memory ≥ 19 MiB, iterations ≥ 2).
 *
 * A 4–6 digit PIN has only ten thousand to a million possibilities, so the cost of a
 * single guess is the whole defence: Argon2id at these settings takes long enough that
 * offline guessing against a stolen hash is slow, while a staff member at the desk
 * waits a few tens of milliseconds.
 *
 * `verify` never throws for a wrong PIN or a malformed hash — the caller treats every
 * failure the same, so nothing distinguishes "no such user" from "wrong PIN".
 */

const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export class Argon2PinHasher implements PinHasher {
  async hash(pin: string): Promise<string> {
    return hash(pin, OPTIONS);
  }

  async verify(storedHash: string, pin: string): Promise<boolean> {
    try {
      return await verify(storedHash, pin, OPTIONS);
    } catch {
      return false;
    }
  }
}
