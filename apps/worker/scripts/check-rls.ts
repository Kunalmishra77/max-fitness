/**
 * Which tables in `public` have row-level security, and which do not.
 *
 * Supabase auto-generates a PostgREST "Data API" over the `public` schema, callable by
 * anyone holding the project's anon key. The init migration enables RLS with no policies on
 * every table it creates, which denies every row to the roles PostgREST connects as, and it
 * says in a comment that every later migration must add its own `ALTER`.
 *
 * That comment is not enforced by anything, so this checks. A table added after the init
 * migration and missing its line is silently published, and the only way to know is to ask
 * the database.
 *
 *   pnpm --filter @mfp/worker run check:rls
 */
import { createPrismaClient } from '@mfp/db/client';

async function main(): Promise<void> {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL is not set');
  const prisma = createPrismaClient({ connectionString: url, poolMax: 2 });

  try {
    // Everything is cast to text or int on purpose. Postgres answers `relkind` as `"char"`,
    // which the pg driver adapter refuses with `UnsupportedNativeDataType`, and
    // `information_schema` columns come back as `sql_identifier` with the same problem. The
    // catalog is the right source; it just has to be asked for types a driver can carry.
    const rows = await prisma.$queryRaw<Array<{ tablename: string; rls: boolean; policies: number }>>`
      SELECT c.relname::text AS tablename,
             c.relrowsecurity AS rls,
             (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind::text = 'r'
       ORDER BY c.relrowsecurity, c.relname
    `;

    const off = rows.filter((r) => !r.rls);
    const on = rows.filter((r) => r.rls);

    console.log(`${rows.length} tables in public: ${on.length} with RLS, ${off.length} without.\n`);
    if (off.length > 0) {
      console.log('WITHOUT RLS — reachable through the Data API if `public` is exposed:');
      for (const r of off) console.log(`   ${r.tablename}`);
      console.log('\nFix with, in a migration:');
      for (const r of off) console.log(`   ALTER TABLE "${r.tablename}" ENABLE ROW LEVEL SECURITY;`);
    } else {
      console.log('Every table has RLS enabled.');
    }

    // A policy on one of these would be a mistake: RLS here is a blanket deny, and a
    // permissive policy would re-open what it is there to close.
    const withPolicies = on.filter((r) => r.policies > 0);
    if (withPolicies.length > 0) {
      console.log(`\nUnexpected: these have policies, which re-open rows RLS is closing — ${withPolicies.map((r) => r.tablename).join(', ')}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

await main();
