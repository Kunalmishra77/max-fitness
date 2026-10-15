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
 *   pnpm wipe:members -- --only="Demo " --yes   # only members whose name contains this
 *   pnpm wipe:members -- --unconfirmed --yes    # only the ones nobody ever confirmed
 *
 * `--only` exists because the register is no longer empty. On 2026-10-01 a real member
 * had filled the form at 8:45 that morning and was sitting in the queue beside two of my
 * own test rows; a blanket wipe would have deleted them. Name the test data, do not
 * assume everything is test data.
 *
 * **`--unconfirmed` is the same caution made into a rule.** The owner asked for a
 * register of real members only — *"hme ab chahiye real members jinka sb ready ho"* —
 * and the honest test for that is not whether a form looks complete but **whether a
 * person at the gym ever confirmed them**: staff approved their request, or they hold a
 * confirmed plan, or they paid, or they walked in and were marked present. Anybody with
 * none of those only ever half-filled a form that nobody acted on.
 *
 * It is deliberately generous — any one of the four is enough — because a member deleted
 * by mistake is gone along with their photograph, and a stale row costs nothing but a
 * line on a screen. Run `backup:members` first regardless; it is what makes this
 * reversible.
 *
 * Photographs go from storage as well as the database, and a key that will not delete is
 * named rather than swallowed: a selfie left in a bucket is the kind of thing nobody
 * notices until it matters.
 */
import { createPrismaClient } from '@mfp/db/client';
import { loadScriptEnv } from './_env';
import { createStorageDriver, type StorageSettings } from '@mfp/integrations/storage';

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const commit = has('--yes');
const resetCounters = has('--counters');
const storageMode = (args.find((arg) => arg.startsWith('--storage='))?.split('=')[1] ?? 'auto') as 'auto' | 's3' | 'local' | 'skip';
/** Case-insensitive substring of the member's name; without it, every member goes. */
const only = args.find((arg) => arg.startsWith('--only='))?.slice('--only='.length)?.trim() ?? '';
/** Only members nobody at the gym ever confirmed. See the note at the top. */
const unconfirmedOnly = has('--unconfirmed');

const need = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
};

const maskMobile = (mobile: string) => `${mobile.slice(0, 5)}xxxxx${mobile.slice(-3)}`;

async function main(): Promise<void> {
  loadScriptEnv();
  const prisma = createPrismaClient({ connectionString: need('DATABASE_URL'), poolMax: 3 });

  try {
    const members = await prisma.member.findMany({
      where: {
        ...(only === '' ? {} : { fullName: { contains: only, mode: 'insensitive' } }),
        /**
         * None of the four marks of a real member. Prisma's `none` on each relation is
         * the whole rule: staff never approved them, they hold no confirmed plan, they
         * never paid, and they have never been marked present.
         */
        ...(unconfirmedOnly
          ? {
              verifications: { none: { status: 'APPROVED' } },
              memberships: { none: { status: 'CONFIRMED' } },
              payments: { none: { status: 'PAID' } },
              attendance: { none: {} },
            }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, fullName: true, mobile: true, memberCode: true, status: true, source: true, createdAt: true },
    });

    if (only !== '') {
      const total = await prisma.member.count();
      console.log(`Only members whose name contains "${only}": ${members.length} of ${total}. The rest are left alone.\n`);
    }
    if (unconfirmedOnly) {
      const total = await prisma.member.count();
      console.log(
        `Only members nobody confirmed — no approved request, no confirmed plan, no payment, never present:\n` +
          `${members.length} of ${total}. The other ${total - members.length} are left alone.\n`,
      );
    }

    if (members.length === 0) {
      console.log('No members matched. Nothing to do.');
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
    /**
     * Written in after a delete failed on `PtEnrolment_memberId_fkey`. This script was
     * written before personal training, diet plans and the WhatsApp assistant existed,
     * and every table added since has to be named here by hand — the schema will not do
     * it for us, and the only warning is a foreign key error halfway through, with the
     * member already stripped of everything above this line.
     *
     * Children before parents: a follow-up belongs to a plan, and a payment points at
     * the PT enrolment it paid for, so enrolments go below with the payments.
     */
    await step('assistant replies', prisma.botReply.deleteMany({ where }));
    await step('diet follow-ups', prisma.dietFollowUp.deleteMany({ where }));
    await step('diet plans', prisma.dietPlan.deleteMany({ where }));
    await step('diet profiles', prisma.dietProfile.deleteMany({ where }));
    // Before payments, because a payment points at the mandate it arrived on (ADR-105), and
    // before members, because a mandate points at the member. Written in after the fact: this
    // script predates autopay, and a member holding a mandate would have refused to delete.
    await step('autopay mandates', prisma.payment.updateMany({ where, data: { mandateId: null } }));
    await step('payments', prisma.payment.deleteMany({ where }));
    // After payments: a payment points at the enrolment it paid for.
    await step('PT enrolments', prisma.ptEnrolment.deleteMany({ where }));
    await step('mandates', prisma.mandate.deleteMany({ where }));
    await step('memberships', prisma.membership.deleteMany({ where }));
    await step('media rows', prisma.mediaFile.deleteMany({ where: { id: { in: files.map((file) => file.id) } } }));
    await step('members', prisma.member.deleteMany({ where: { id: { in: ids } } }));

    // These three are not member-scoped, so they only run on a full wipe. Clearing every
    // enquiry, or every counter, because two test rows were removed would take somebody
    // real with them — and `--unconfirmed` is exactly that case: it leaves members
    // standing, so the gym's enquiries and counters must stand with them.
    if (only === '' && !unconfirmedOnly) {
      await step('enquiries', prisma.lead.deleteMany({}));
      // Queued work names members by id inside its payload, so whatever is still pending
      // is about somebody who no longer exists.
      await step('queued events', prisma.outboxEvent.deleteMany({ where: { status: 'PENDING' } }));
      if (resetCounters) {
        const { count } = await prisma.counter.updateMany({ data: { value: 0 } });
        done.push(['counters reset', count]);
      }
    } else {
      console.log('  enquiries, queued events and counters: left alone (--only)');
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
