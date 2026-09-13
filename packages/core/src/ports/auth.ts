/**
 * Password/PIN hashing (security-plan.md §3.1).
 *
 * A port because the algorithm is infrastructure: the domain only needs to ask "is this
 * the right PIN?". The adapter is Argon2id in packages/integrations.
 */
export interface PinHasher {
  /** True only when the PIN matches. Never throws for a wrong PIN or a malformed hash. */
  verify(storedHash: string, pin: string): Promise<boolean>;
}
