/**
 * Put the owner's real name on the seeded account (owner, 2026-10-01; ADR-086).
 *
 * The CRM greeted the gym's owner as "Demo Owner" and reception as "Demo Staff",
 * because that is what `packages/db/seed/index.ts` writes. Everything else about those
 * accounts is real and in use, so this renames them rather than making new ones — the
 * PINs, sessions and the audit trail all stay where they are.
 *
 * It does NOT change the PINs. They are still 2468 and 1357, they are written down in
 * our own documentation, and only the owner should choose what replaces them — from
 * Max Register → Staff, on their own phone.
 *
 *   pnpm --filter @mfp/worker run set:staff
 *   pnpm --filter @mfp/worker run set:staff -- --yes
 */
import { createPrismaClient } from '@mfp/db/client';

const commit = process.argv.includes('--yes');

/** Keyed by mobile, because that is what the person signs in with. */
const NAMES: Readonly<Record<string, string>> = {
  '+919000000001': 'Ajay',
  '+919000000002': 'Reception',
};

async function main(): Promise<void> {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL is not set');
  const prisma = createPrismaClient({ connectionString: url, poolMax: 2 });

  try {
    const staff = await prisma.staffUser.findMany({ select: { id: true, name: true, mobile: true, role: true }, orderBy: { role: 'asc' } });
    const changes = staff.filter((person) => NAMES[person.mobile] !== undefined && NAMES[person.mobile] !== person.name);

    for (const person of staff) {
      const next = NAMES[person.mobile];
      console.log(`  ${person.role.padEnd(10)} ${person.name.padEnd(16)} ${next === undefined ? '(not in the list)' : next === person.name ? 'unchanged' : `→ ${next}`}`);
    }

    if (!commit) {
      console.log(`\nDry run — ${changes.length} name${changes.length === 1 ? '' : 's'} would change. Pass --yes.`);
      return;
    }

    for (const person of changes) {
      const next = NAMES[person.mobile];
      if (next !== undefined) await prisma.staffUser.update({ where: { id: person.id }, data: { name: next } });
    }
    console.log(`\nWritten: ${changes.length} name${changes.length === 1 ? '' : 's'}. The PINs are unchanged — the owner sets those in Max Register.`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
