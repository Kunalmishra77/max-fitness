import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

/**
 * Create and migrate the database the integration tests run against (ADR-129).
 *
 *   pnpm db:migrate:test
 *
 * Until 2026-10-16 `TEST_DATABASE_URL` and `DATABASE_URL` named the same database, so
 * `pnpm test` wrote into the live register. It left stray gyms behind when a test failed
 * and, on the day the gym went live, put forty message-log rows in front of the owner
 * under a member who did not exist. A test suite that can damage the thing it is testing
 * is not a safety net.
 *
 * **A separate database, not a separate schema.** The schema was tried first and does
 * not work: Prisma qualifies every table as `"public"."Member"`, so `search_path` is
 * ignored and the generated client reads the live rows whatever the connection says. A
 * database carries its own `public`, which is what the client is already looking for.
 *
 * It lives on the same Supabase instance, costs nothing, and both poolers reach it.
 */

const withDb = (base: string, db: string): string => {
  const url = new URL(base);
  url.pathname = `/${db}`;
  url.searchParams.delete('schema');
  return url.toString();
};

const TEST_DB = 'mfp_test';

async function main(): Promise<void> {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
  } catch {
    /* CI supplies the environment itself. */
  }
  const direct = process.env['DIRECT_URL'];
  if (direct === undefined || direct === '') throw new Error('DIRECT_URL is not set');

  // Migrations go through the session pooler: Prisma's Schema Engine holds one
  // connection and does not work behind the transaction pooler.
  const admin = new Client({ connectionString: direct });
  await admin.connect();
  const exists = await admin.query('select 1 from pg_database where datname = $1', [TEST_DB]);
  if (exists.rowCount === 0) {
    // No parameters in DDL; the name is a constant above, never user input.
    await admin.query(`CREATE DATABASE "${TEST_DB}"`);
    console.log(`created database ${TEST_DB}`);
  } else {
    console.log(`database ${TEST_DB} already exists`);
  }
  await admin.end();

  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DIRECT_URL: withDb(direct, TEST_DB) },
  });
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    return;
  }

  /**
   * The check that made this worth writing. ADR-011 requires RLS on every table in
   * `public`; production had it because somebody ran the ALTERs by hand, and the
   * migrations did not. Standing a database up from nothing is the only way to find
   * that out, so it is checked here every time.
   */
  const test = new Client({ connectionString: withDb(direct, TEST_DB) });
  await test.connect();
  const off = await test.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' and rowsecurity = false order by 1",
  );
  await test.end();

  if (off.rowCount === 0) {
    console.log('\nRLS is on for every table. Point TEST_DATABASE_URL at this database and run pnpm test.');
    return;
  }
  console.error(`\n${off.rowCount} table(s) have no RLS — a migration is missing it (ADR-011):`);
  for (const row of off.rows) console.error(`  ALTER TABLE "${row.tablename}" ENABLE ROW LEVEL SECURITY;`);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
