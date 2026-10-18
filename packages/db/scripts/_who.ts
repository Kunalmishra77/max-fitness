import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

async function main(): Promise<void> {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
  const url = new URL(process.env['DIRECT_URL'] ?? '');
  url.pathname = '/mfp_test';
  const c = new Client({ connectionString: url.toString() });
  await c.connect();
  const r = await c.query<{ name: string; mobile: string; role: string; isActive: boolean; failedAttempts: number; lockedUntil: Date | null }>(
    'select name, mobile, role, "isActive", "failedAttempts", "lockedUntil" from "StaffUser" order by role',
  );
  for (const s of r.rows) console.log(`${s.role.padEnd(10)} ${s.mobile.padEnd(16)} active=${s.isActive} failed=${s.failedAttempts} locked=${s.lockedUntil?.toISOString() ?? 'no'}`);
  const sessions = await c.query<{ n: number }>('select count(*)::int n from "StaffSession"');
  console.log('sessions:', sessions.rows[0]?.n ?? 0);
  await c.end();
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
