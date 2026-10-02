/**
 * Create this gym's trial follow-up rules (ADR-088).
 *
 * The migration added `ReminderRule.appliesTo` and defaulted every existing row to
 * `MEMBERSHIP`, which is right — they are all renewal rules. The three trial rules have to
 * be created, and only a seeded gym gets them from the seed. This does it for a live one.
 *
 *   pnpm --filter @mfp/worker run set:trial-rules        # says what it would do
 *   pnpm --filter @mfp/worker run set:trial-rules -- --yes
 */
import { DEFAULT_REMINDER_RULES } from '@mfp/shared';
import { createPrismaClient } from '@mfp/db/client';

const commit = process.argv.includes('--yes');

const need = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
};

const TRIAL_RULES = DEFAULT_REMINDER_RULES.filter((rule) => rule.appliesTo === 'TRIAL');

async function main(): Promise<void> {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
  const prisma = createPrismaClient({ connectionString: need('DATABASE_URL'), poolMax: 2 });

  try {
    const gym = await prisma.gym.findFirstOrThrow({ select: { id: true, name: true } });
    const existing = new Map(
      (await prisma.reminderRule.findMany({ where: { gymId: gym.id }, select: { code: true, appliesTo: true, slots: true, isEnabled: true } })).map(
        (rule) => [rule.code, rule],
      ),
    );

    console.log(`${gym.name}\n`);
    for (const rule of TRIAL_RULES) {
      const was = existing.get(rule.code);
      const mark = was === undefined ? 'create' : was.appliesTo === 'TRIAL' ? 'unchanged' : 'fix appliesTo';
      console.log(`  ${rule.code.padEnd(12)} ${mark.padEnd(14)} offset ${String(rule.offsetDays).padStart(3)}  at ${rule.slots.join(', ')}  ${rule.templateName}`);
    }
    const toWrite = TRIAL_RULES.filter((rule) => existing.get(rule.code)?.appliesTo !== 'TRIAL');

    if (!commit) {
      console.log(`\nDry run — ${toWrite.length} rule${toWrite.length === 1 ? '' : 's'} would be written. Pass --yes.`);
      return;
    }

    for (const rule of toWrite) {
      await prisma.reminderRule.upsert({
        where: { gymId_code: { gymId: gym.id, code: rule.code } },
        create: {
          gymId: gym.id,
          code: rule.code,
          appliesTo: 'TRIAL',
          offsetDays: rule.offsetDays,
          offsetDaysTo: rule.offsetDaysTo,
          slots: [...rule.slots],
          templateName: rule.templateName,
          isEnabled: true,
        },
        update: { appliesTo: 'TRIAL', offsetDays: rule.offsetDays, offsetDaysTo: rule.offsetDaysTo, slots: [...rule.slots], templateName: rule.templateName },
      });
    }
    console.log(`\nWritten: ${toWrite.length} trial rule${toWrite.length === 1 ? '' : 's'}.`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
