import { fileURLToPath } from 'node:url';
import { describe } from 'vitest';

/**
 * Shared set-up for database integration tests (testing-strategy.md §1, ADR-010).
 *
 * They need a real, migrated PostgreSQL database named by `TEST_DATABASE_URL`. When it
 * is unset every suite is skipped with a message, so `pnpm test` stays green on a
 * fresh clone and unit tests never need a database.
 */
try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // No .env: rely on the process environment (CI).
}

const url = process.env['TEST_DATABASE_URL']?.trim();

export const testDatabaseUrl: string = url ?? '';
export const integrationEnabled = url !== undefined && url !== '';

/** `describe`, or `describe.skip` with a one-line explanation when there is no database. */
export function integrationSuite(name: string): typeof describe | typeof describe.skip {
  if (!integrationEnabled) {
    console.warn(`[db integration] TEST_DATABASE_URL is not set — skipping "${name}" (ADR-010).`);
    return describe.skip;
  }
  return describe;
}
