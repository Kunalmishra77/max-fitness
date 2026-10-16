/**
 * Clear the practice runs out of the message log, before the gym starts sending for real.
 *
 *   pnpm --filter @mfp/worker run clear:messages          # says what it would do
 *   pnpm --filter @mfp/worker run clear:messages -- --yes
 *
 * On the day this was written the log held 430 `SIMULATED` rows and 1068 `SKIPPED` ones
 * against two real sends. The owner opened Messages and saw four hundred and seventy-eight
 * cards of *"Welcome to Max Fitness Gym, Test!"*. None of it happened — demo mode writes
 * the row and sends nothing — and when `DEMO_MODE` goes off the first real inbox would
 * have opened underneath all of it.
 *
 * **It deletes only what never reached anybody.**
 *
 * - `SIMULATED` — demo mode's record of a message it did not send.
 * - `SKIPPED` — the engine deciding not to send. Mostly `ALREADY_SENT` from the duplicate
 *   insert fixed in ADR-115, which is a bug's exhaust rather than a decision anybody
 *   needs to read back.
 *
 * **It never touches a real send.** `SENT`, `DELIVERED`, `READ` and `FAILED` are what the
 * gym actually did and what a member can ask about — *"maine to paisa de diya tha, aapne
 * message kyun bheja"* is answered from these rows and nowhere else. `QUEUED` is left too:
 * it is work in flight, and deleting it mid-send would strand a message the provider is
 * about to confirm.
 *
 * Nothing about a member is printed beyond a count.
 */
import { createPrismaClient } from '@mfp/db/client';
import { loadScriptEnv } from './_env';

const commit = process.argv.includes('--yes');

/** Rows that stand for a message nobody received. Everything else is the gym's record. */
const NEVER_SENT = ['SIMULATED', 'SKIPPED'] as const;

async function main(): Promise<void> {
  loadScriptEnv();
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL is not set');
  const prisma = createPrismaClient({ connectionString: url, poolMax: 2 });

  try {
    const byStatus = await prisma.messageLog.groupBy({ by: ['status'], _count: { _all: true } });
    const count = (status: string) => byStatus.find((row) => row.status === status)?._count._all ?? 0;

    console.log('\nMessage log:\n');
    for (const row of [...byStatus].sort((a, b) => b._count._all - a._count._all)) {
      const fate = (NEVER_SENT as readonly string[]).includes(row.status) ? 'delete' : 'keep';
      console.log(`  ${row.status.padEnd(10)} ${String(row._count._all).padStart(6)}   ${fate}`);
    }

    const going = NEVER_SENT.reduce((sum, status) => sum + count(status), 0);
    const staying = byStatus.reduce((sum, row) => sum + row._count._all, 0) - going;
    console.log(`\n  ${going} row(s) stand for a message nobody received. ${staying} real send(s) stay.`);

    /**
     * Queued work that names a member who no longer exists. It can never succeed and
     * will be retried until somebody notices, so it is counted here — but not deleted,
     * because a pending event is the worker's business and this script is not the worker.
     */
    const stuck = await prisma.outboxEvent.count({ where: { status: 'PENDING' } });
    if (stuck > 0) console.log(`  ${stuck} outbox event(s) still PENDING — worth a look if they do not clear.`);

    if (going === 0) {
      console.log('\nNothing to clear.\n');
      return;
    }
    if (!commit) {
      console.log('\nDry run — nothing was deleted. Pass --yes to clear them.\n');
      return;
    }

    const { count: gone } = await prisma.messageLog.deleteMany({ where: { status: { in: [...NEVER_SENT] } } });
    console.log(`\nDeleted ${gone}. The log now holds what the gym actually sent.\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
