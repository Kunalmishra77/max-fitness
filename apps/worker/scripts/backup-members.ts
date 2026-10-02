/**
 * Write every member and what is attached to them to one JSON file, before a wipe.
 *
 * A wipe is irreversible and the register holds real people's names and phone numbers —
 * the ones who scanned the poster and typed their details in. Losing those is losing the
 * gym's enquiries, so they are written out first and the owner keeps the file.
 *
 * The file lands in `backups/`, which `.gitignore` excludes, because it is personal data
 * and must never reach a repository.
 *
 *   pnpm --filter @mfp/worker run backup:members
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrismaClient } from '@mfp/db/client';

async function main(): Promise<void> {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL is not set');
  const prisma = createPrismaClient({ connectionString: url, poolMax: 2 });

  try {
    const members = await prisma.member.findMany({
      where: { deletedAt: null },
      include: {
        memberships: true,
        payments: true,
        ptEnrolments: true,
        dietPlans: true,
        dietProfile: true,
        consents: true,
        attendance: { select: { attendanceDate: true, method: true, capturedAt: true } },
        callTasks: true,
        verifications: true,
        messages: { select: { purpose: true, status: true, sentAt: true, bodyPreview: true, createdAt: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const leads = await prisma.lead.findMany({ orderBy: { createdAt: 'asc' } });

    const root = join(fileURLToPath(new URL('../../..', import.meta.url)), 'backups');
    mkdirSync(root, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = join(root, `members-${stamp}.json`);

    // BigInt and Date both need telling how to become JSON; a silent throw here would
    // leave the owner with no backup and a wipe about to run.
    const json = JSON.stringify(
      { takenAt: new Date().toISOString(), memberCount: members.length, leadCount: leads.length, members, leads },
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2,
    );
    writeFileSync(file, json, 'utf8');

    console.log(`${members.length} members and ${leads.length} enquiries written to:`);
    console.log(`  ${file}`);
    console.log(`  ${(json.length / 1024).toFixed(0)} KB`);
    console.log('\nThis file holds real names and phone numbers. It is outside git on purpose — keep it somewhere safe.');
  } finally {
    await prisma.$disconnect();
  }
}

await main();
