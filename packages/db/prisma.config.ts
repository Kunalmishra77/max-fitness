import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

// The .env file lives at the repo root, but the Prisma CLI runs with packages/db as
// its working directory. Node's built-in loader reads it without adding a dependency
// and never overrides a variable that is already set (e.g. in CI).
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch {
  // No .env file: rely on the process environment.
}

const directUrl = process.env['DIRECT_URL'];
const shadowDatabaseUrl = process.env['SHADOW_DATABASE_URL'];

/**
 * Prisma CLI configuration (ADR-010).
 *
 * The URL here is the **migration** URL, and it is deliberately `DIRECT_URL`, not
 * `DATABASE_URL`. Prisma's Schema Engine holds a single connection and does not
 * work behind a transaction pooler, so every migrate/db command must go through
 * Supavisor's *session* pooler on :5432. The application's runtime connection is a
 * different thing entirely: `src/client.ts` builds a `PrismaClient` over
 * `DATABASE_URL` (:6543, transaction mode) with `@prisma/adapter-pg`.
 *
 * In Prisma 7 the `directUrl` datasource property was removed and
 * `shadowDatabaseUrl` moved out of `schema.prisma` into this file, so both live
 * here now.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',

  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx seed/index.ts',
  },

  datasource: {
    // Session pooler (:5432). Migrations, `db pull/push`, and Studio.
    // Prisma 7's env() helper throws when a variable is unset, which would break
    // `prisma generate` in CI (no database there). Generation never connects, so an
    // unset URL is only an error for commands that do — and Prisma says so itself.
    url: directUrl ?? '',

    // Optional. `prisma migrate dev` normally creates and drops its own shadow
    // database, which needs CREATEDB on the connecting role. If the Supabase role
    // lacks it, point this at a SEPARATE, EMPTY Supabase project — Prisma resets
    // that database on every `migrate dev`, so it must never hold real data.
    // `migrate deploy`, used in CI/CD, needs no shadow database at all.
    ...(shadowDatabaseUrl !== undefined && shadowDatabaseUrl.trim() !== '' ? { shadowDatabaseUrl } : {}),
  },
});
