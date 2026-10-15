/**
 * Delete the gyms integration tests left behind (ADR-115).
 *
 *   pnpm --filter @mfp/worker run delete:test-gyms          # says what it would delete
 *   pnpm --filter @mfp/worker run delete:test-gyms -- --yes
 *
 * The integration suite makes a gym per run, fills it with fixtures and drops it in
 * `afterAll`. A run that dies in the middle — which the shared database's connection
 * limit caused repeatedly on 2026-10-07 — never reaches the teardown, and the gym stays.
 * Twelve had collected in production by 2026-10-15.
 *
 * **It only ever touches ids beginning `gym_it_`**, which the tests write and nothing
 * else does; the real gym is `gym_demo_max_fitness`. Every table is named here by hand
 * rather than reached through a dynamic lookup: this deletes from the live database, and
 * a list somebody can read beats one that is clever.
 */
import { createPrismaClient } from '@mfp/db/client';

const commit = process.argv.includes('--yes');

/** What the tests name their gyms, and nothing else does. */
const TEST_PREFIX = 'gym_it_';

const need = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
};

/** One table: how to count its rows, and how to delete them. */
interface Table {
  readonly name: string;
  readonly count: () => Promise<number>;
  readonly remove: () => Promise<{ readonly count: number }>;
}

async function main(): Promise<void> {
  const prisma = createPrismaClient({ connectionString: need('DATABASE_URL'), poolMax: 3 });
  try {
    const gyms = await prisma.gym.findMany({ select: { id: true, name: true } });
    const doomed = gyms.filter((gym) => gym.id.startsWith(TEST_PREFIX));
    const kept = gyms.filter((gym) => !gym.id.startsWith(TEST_PREFIX));

    console.log(`keeping ${kept.length}: ${kept.map((gym) => `${gym.id} (${gym.name})`).join(', ')}`);
    console.log(`${doomed.length} test ${doomed.length === 1 ? 'gym' : 'gyms'} to delete\n`);
    if (doomed.length === 0) return;

    const gymId = { in: doomed.map((gym) => gym.id) };
    const where = { gymId };

    /**
     * Children before parents. The order is the integration suite's own teardown order,
     * which is the only place it has been proved against real foreign keys.
     */
    const tables: readonly Table[] = [
      { name: 'AuditLog', count: () => prisma.auditLog.count({ where }), remove: () => prisma.auditLog.deleteMany({ where }) },
      { name: 'OutboxEvent', count: () => prisma.outboxEvent.count({ where }), remove: () => prisma.outboxEvent.deleteMany({ where }) },
      { name: 'WebhookEvent', count: () => prisma.webhookEvent.count({ where }), remove: () => prisma.webhookEvent.deleteMany({ where }) },
      { name: 'JobRun', count: () => prisma.jobRun.count({ where }), remove: () => prisma.jobRun.deleteMany({ where }) },
      { name: 'Alert', count: () => prisma.alert.count({ where }), remove: () => prisma.alert.deleteMany({ where }) },
      { name: 'Announcement', count: () => prisma.announcement.count({ where }), remove: () => prisma.announcement.deleteMany({ where }) },
      { name: 'BotReply', count: () => prisma.botReply.count({ where }), remove: () => prisma.botReply.deleteMany({ where }) },
      { name: 'BotDocument', count: () => prisma.botDocument.count({ where }), remove: () => prisma.botDocument.deleteMany({ where }) },
      { name: 'BotConfig', count: () => prisma.botConfig.count({ where }), remove: () => prisma.botConfig.deleteMany({ where }) },
      { name: 'GalleryPhoto', count: () => prisma.galleryPhoto.count({ where }), remove: () => prisma.galleryPhoto.deleteMany({ where }) },
      { name: 'KioskDevice', count: () => prisma.kioskDevice.count({ where }), remove: () => prisma.kioskDevice.deleteMany({ where }) },
      { name: 'Consent', count: () => prisma.consent.count({ where }), remove: () => prisma.consent.deleteMany({ where }) },
      { name: 'OtpCode', count: () => prisma.otpCode.count({ where }), remove: () => prisma.otpCode.deleteMany({ where }) },
      { name: 'AttendanceEvent', count: () => prisma.attendanceEvent.count({ where }), remove: () => prisma.attendanceEvent.deleteMany({ where }) },
      { name: 'EnrollmentJob', count: () => prisma.enrollmentJob.count({ where }), remove: () => prisma.enrollmentJob.deleteMany({ where }) },
      { name: 'FaceTemplate', count: () => prisma.faceTemplate.count({ where }), remove: () => prisma.faceTemplate.deleteMany({ where }) },
      { name: 'DietFollowUp', count: () => prisma.dietFollowUp.count({ where }), remove: () => prisma.dietFollowUp.deleteMany({ where }) },
      { name: 'DietPlan', count: () => prisma.dietPlan.count({ where }), remove: () => prisma.dietPlan.deleteMany({ where }) },
      { name: 'DietProfile', count: () => prisma.dietProfile.count({ where }), remove: () => prisma.dietProfile.deleteMany({ where }) },
      { name: 'CallTask', count: () => prisma.callTask.count({ where }), remove: () => prisma.callTask.deleteMany({ where }) },
      { name: 'Lead', count: () => prisma.lead.count({ where }), remove: () => prisma.lead.deleteMany({ where }) },
      { name: 'MessageLog', count: () => prisma.messageLog.count({ where }), remove: () => prisma.messageLog.deleteMany({ where }) },
      { name: 'VerificationRequest', count: () => prisma.verificationRequest.count({ where }), remove: () => prisma.verificationRequest.deleteMany({ where }) },
      { name: 'Mandate', count: () => prisma.mandate.count({ where }), remove: () => prisma.mandate.deleteMany({ where }) },
      { name: 'Payment', count: () => prisma.payment.count({ where }), remove: () => prisma.payment.deleteMany({ where }) },
      { name: 'PtEnrolment', count: () => prisma.ptEnrolment.count({ where }), remove: () => prisma.ptEnrolment.deleteMany({ where }) },
      { name: 'Membership', count: () => prisma.membership.count({ where }), remove: () => prisma.membership.deleteMany({ where }) },
      { name: 'MediaFile', count: () => prisma.mediaFile.count({ where }), remove: () => prisma.mediaFile.deleteMany({ where }) },
      { name: 'Member', count: () => prisma.member.count({ where }), remove: () => prisma.member.deleteMany({ where }) },
      { name: 'StaffUser', count: () => prisma.staffUser.count({ where }), remove: () => prisma.staffUser.deleteMany({ where }) },
      { name: 'Counter', count: () => prisma.counter.count({ where }), remove: () => prisma.counter.deleteMany({ where }) },
      { name: 'ReminderRule', count: () => prisma.reminderRule.count({ where }), remove: () => prisma.reminderRule.deleteMany({ where }) },
      { name: 'Plan', count: () => prisma.plan.count({ where }), remove: () => prisma.plan.deleteMany({ where }) },
    ];

    let total = 0;
    for (const table of tables) {
      // A member points at their photo and the photo belongs to the member: let the photo
      // go first, or neither can be deleted.
      if (table.name === 'MediaFile' && commit) await prisma.member.updateMany({ where, data: { photoMediaId: null } });
      if (table.name === 'StaffUser' && commit) await prisma.session.deleteMany({ where: { staffUser: { gymId } } });

      const rows = commit ? (await table.remove()).count : await table.count();
      if (rows > 0) console.log(`  ${table.name.padEnd(22)} ${rows}`);
      total += rows;
    }

    if (commit) {
      const { count } = await prisma.gym.deleteMany({ where: { id: gymId } });
      console.log(`\ndeleted ${count} gyms and ${total} rows`);
    } else {
      console.log(`\n${total} rows belong to them. Re-run with -- --yes to delete.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
