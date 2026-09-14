/**
 * One more try for work that failed.
 *
 * For lookups where a passing hiccup — a dropped pooled connection, a cold function —
 * would otherwise be mistaken for a real answer. The session lookup is the reason it
 * exists: its failure used to become "no session", which signed staff out mid-work.
 *
 * Only a failure is retried. An answer, including `null`, is returned as it is.
 */
export async function withOneRetry<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch {
    return await work();
  }
}
