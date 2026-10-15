/**
 * Files sitting in the bucket that the database has forgotten.
 *
 *   pnpm --filter @mfp/worker run find:orphans          # lists them, changes nothing
 *   pnpm --filter @mfp/worker run find:orphans -- --yes # deletes them
 *
 * Written after a wipe died halfway through on 2026-10-15. The media *rows* for sixteen
 * members were deleted, the foreign key on a table the script had never heard of stopped
 * it before it reached the objects, and thirteen selfies and ID photographs were left in
 * the bucket with nothing in the database pointing at them.
 *
 * **An orphaned ID photograph is the worst kind of leftover.** It is somebody's Aadhaar,
 * it is no longer attached to a member, so no deletion request will ever find it, and
 * under DPDP the gym is holding personal data it has no record of and no reason for.
 *
 * **It reads the whole bucket and trusts the database, which is the only safe direction.**
 * Anything the database still points at is kept, whatever it looks like. Only a key no
 * row mentions is an orphan, and even then it is printed before it is touched.
 */
import { createPrismaClient } from '@mfp/db/client';
import { loadScriptEnv } from './_env';
import { createS3Client, listAllObjects, S3StorageDriver } from '@mfp/integrations/storage';

const commit = process.argv.includes('--yes');

const need = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
};

async function main(): Promise<void> {
  loadScriptEnv();
  const prisma = createPrismaClient({ connectionString: need('DATABASE_URL'), poolMax: 2 });

  try {
    const bucket = need('S3_BUCKET');
    const client = createS3Client({
      endpoint: need('S3_ENDPOINT'),
      region: need('S3_REGION'),
      accessKeyId: need('S3_ACCESS_KEY_ID'),
      secretAccessKey: need('S3_SECRET_ACCESS_KEY'),
    });
    const storage = new S3StorageDriver({ client, bucket, urlSigningSecret: need('LINK_TOKEN_SECRET') });

    // Every key the database still knows about, deleted rows included: a row marked
    // deleted but not yet swept is not an orphan, it is a pending sweep.
    const rows = await prisma.mediaFile.findMany({
      select: {
        storageKey: true,
        kind: true,
        label: true,
        createdAt: true,
        member: { select: { memberCode: true, fullName: true } },
      },
    });
    const known = new Set(rows.map((row) => row.storageKey));
    const inBucket = new Set(await listAllObjects(client, bucket));

    const orphans = [...inBucket].filter((key) => !known.has(key));
    console.log(`${inBucket.size} objects in the bucket, ${known.size} known to the database.`);

    /**
     * The other direction, and the one that hurts a member rather than the gym: a row
     * pointing at a file that is not there. The screen shows a broken photograph and
     * the desk has no way to tell whether it was never uploaded or quietly swept.
     *
     * It is only ever reported. Deleting the row would hide the problem and lose the
     * only record that the file was ever expected.
     */
    const missing = rows.filter((row) => !inBucket.has(row.storageKey));
    if (missing.length > 0) {
      console.log(`\n⚠ ${missing.length} file(s) the database expects but the bucket does not have:\n`);
      for (const row of missing) {
        const owner = row.member === null ? 'no member' : `${row.member.memberCode ?? '—'} ${row.member.fullName}`;
        console.log(`  ${row.kind.padEnd(8)} ${(row.label ?? '—').padEnd(14)} ${owner.padEnd(28)} added ${row.createdAt.toISOString().slice(0, 10)}`);
      }
      console.log('\n  Nothing was changed. These need the member to send the photograph again.');
    }

    if (orphans.length === 0) {
      console.log('No orphans. Nothing to do.');
      return;
    }

    console.log(`\n${orphans.length} orphan${orphans.length === 1 ? '' : 's'}:\n`);
    for (const key of orphans) console.log(`  ${key}`);

    if (!commit) {
      console.log('\nDry run — nothing was deleted. Pass --yes to remove them.');
      return;
    }

    let gone = 0;
    for (const key of orphans) {
      try {
        await storage.delete(key);
        gone += 1;
      } catch (error) {
        // Named, not swallowed: a file that would not delete is the one that matters.
        console.error(`  could not delete ${key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log(`\nDeleted ${gone} of ${orphans.length}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
