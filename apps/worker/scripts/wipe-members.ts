/**
 * Remove every member and everything belonging to them, leaving the gym itself set up.
 *
 * Tests run against this database — one Supabase project, by the client's decision — and
 * a test member is indistinguishable from a real one to whoever is looking at the
 * register. ADR-073 cleared it by hand once; doing that by hand twice is how a real
 * member gets deleted, so this is a script, and its default is to change nothing.
 *
 * Kept: the gym and its settings, staff logins, plans, reminder rules, and the audit log
 * — an audit trail that gets erased with the evidence is not an audit trail.
 *
 *   pnpm wipe:members                      # says what it would do, changes nothing
 *   pnpm wipe:members -- --yes             # does it
 *   pnpm wipe:members -- --yes --counters  # and restarts member codes and receipts at 1
 *   pnpm wipe:members -- --yes --storage=skip   # leave the files alone
 *
 * Photographs go from storage as well as the database, and a key that will not delete is
 * named rather than swallowed: a selfie left in a bucket is the kind of thing nobody
 * notices until it matters.
 */
import { createPrismaClient } from '@mfp/db/client';
import { createStorageDriver, type StorageSettings } from '@mfp/integrations/storage';

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const commit = has('--yes');
const resetCounters = has('--counters');
const storageMode = (args.find((arg) => arg.startsWith('--storage='))?.split('=')[1] ?? 'auto') as 'auto' | 's3' | 'local' | 'skip';

const need = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
};

const maskMobile = (mobile: string) => `${mobile.slice(0, 5)}xxxxx${mobile.slice(-3)}`;

async function main(): Promise<void> {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
  const prisma = createPrismaClient({ connectionString: need('DATABASE_URL'), poolMax: 3 });

  try {
    const members = await prisma.member.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, fullName: true, mobile: true, memberCode: true, status: true, source: true, createdAt: true },
    });

    if (members.length === 0) {
      console.log('No members. Nothing to do.');
      return;
    }

    const ids = members.map((member) => member.id);
    // Their own media, plus the receipts on their payments: a receipt carries the name.
    const receiptIds = (await prisma.payment.findMany({ where: { memberId: { in: ids }, receiptMediaId: { not: null } }, select: { receiptMediaId: true } }))
      .map((row) => row.receiptMediaId)
      .filter((id): id is string => id !== null);
    const files = await prisma.mediaFile.findMany({
      where: { OR: [{ memberId: { in: ids } }, { id: { in: receiptIds } }] },
      select: { id: true, storageKey: true },
    });

    console.log(`${members.length} member${members.length === 1 ? '' : 's'}:`);
    for (const member of members) {
      console.log(
        `  ${member.createdAt.toISOString().slice(0, 16)}  ${String(member.memberCode ?? '-').padEnd(8)} ${member.fullName.padEnd(22)} ${maskMobile(member.mobile)}  ${member.status}  ${member.source}`,
      );
    }
    console.log(`\nWith them go ${files.length} file${files.length === 1 ? '' : 's'} in storage, and their memberships, payments, verifications, consents, attendance, messages, calls, alerts and enquiries.`);
    console.log(resetCounters ? 'Counters restart at 1, so the next member is MF-0001.' : 'Counters stay where they are.');

    if (!commit) {
      console.log('\nDry run — nothing was changed. Pass --yes to delete.');
      return;
    }

    // Member and MediaFile point at each other, so the links are cut first.
    await prisma.member.updateMany({ where: { id: { in: ids } }, data: { photoMediaId: null } });
    await prisma.payment.updateMany({ where: { memberId: { in: ids } }, data: { receiptMediaId: null } });

    const where = { memberId: { in: ids } };
    const done: Array<[string, number]> = [];
    const step = async (label: string, run: Promise<{ count: number }>) => done.push([label, (await run).count]);

    await step('messages', prisma.messageLog.deleteMany({ where }));
    await step('attendance', prisma.attendanceEvent.deleteMany({ where }));
    await step('enrolment jobs', prisma.enrollmentJob.deleteMany({ where }));
    await step('face templates', prisma.faceTemplate.deleteMany({ where }));
    await step('consents', prisma.consent.deleteMany({ where }));
    await step('verifications', prisma.verificationRequest.deleteMany({ where }));
    await step('call tasks', prisma.callTask.deleteMany({ where }));
    await step('alerts', prisma.alert.deleteMany({ where }));
    await step('payments', prisma.payment.deleteMany({ where }));
    await step('memberships', prisma.membership.deleteMany({ where }));
    await step('media rows', prisma.mediaFile.deleteMany({ where: { id: { in: files.map((file) => file.id) } } }));
    await step('members', prisma.member.deleteMany({ where: { id: { in: ids } } }));
    await step('enquiries', prisma.lead.deleteMany({}));
    // Queued work names members by id inside its payload, so whatever is still pending
    // is about somebody who no longer exists.
    await step('queued events', prisma.outboxEvent.deleteMany({ where: { status: 'PENDING' } }));

    if (resetCounters) {
      const { count } = await prisma.counter.updateMany({ data: { value: 0 } });
      done.push(['counters reset', count]);
    }

    for (const [label, n] of done) console.log(`  ${label}: ${n}`);

    if (storageMode === 'skip' || files.length === 0) {
      console.log(`  storage: left alone (${files.length} object${files.length === 1 ? '' : 's'} still in the bucket)`);
    } else {
      // The local .env keeps STORAGE_DRIVER=local for development, but these objects are
      // in the bucket the deployed app writes to, so the bucket is the default here.
      const driver = storageMode === 'local' ? 'local' : storageMode === 's3' || process.env['S3_BUCKET'] ? 's3' : 'local';
      const settings: StorageSettings = {
        STORAGE_DRIVER: driver,
        STORAGE_LOCAL_PATH: process.env['STORAGE_LOCAL_PATH'] ?? './storage',
        S3_ENDPOINT: process.env['S3_ENDPOINT'] ?? '',
        S3_REGION: process.env['S3_REGION'] ?? '',
        S3_BUCKET: process.env['S3_BUCKET'] ?? '',
        S3_ACCESS_KEY_ID: process.env['S3_ACCESS_KEY_ID'] ?? '',
        S3_SECRET_ACCESS_KEY: process.env['S3_SECRET_ACCESS_KEY'] ?? '',
        LINK_TOKEN_SECRET: need('LINK_TOKEN_SECRET'),
      };
      const storage = createStorageDriver(settings);
      let removed = 0;
      const failed: string[] = [];
      let firstReason: string | null = null;
      for (const file of files) {
        try {
          await storage.delete(file.storageKey);
          removed += 1;
        } catch (error) {
          failed.push(file.storageKey);
          // Why it failed matters more than how many: a wrong endpoint and a missing
          // object are the same count and completely different problems.
          firstReason ??= error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        }
      }
      console.log(`  storage objects deleted (${driver}): ${removed}`);
      if (failed.length > 0) {
        console.log(`  COULD NOT DELETE ${failed.length} object${failed.length === 1 ? '' : 's'} — ${firstReason ?? 'no reason given'}`);
        console.log(`  keys left behind:\n    ${failed.join('\n    ')}`);
      }
    }

    console.log('\nDone. The gym, its settings, staff, plans and reminder rules are untouched.');
  } finally {
    await prisma.$disconnect();
  }
}

await main();
