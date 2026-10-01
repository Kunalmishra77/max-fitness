/**
 * Put the gym's real opening hours into settings (owner, 2026-10-01; ADR-082).
 *
 * Mon–Sat it opens twice — 04:30 to 12:00, shutters down, then 17:00 to 22:00 — and all
 * day Sunday it is shut. Settings held one stretch per day, so the site said
 * "4:30 am – 10:00 pm" and told everybody the gym was open at three in the afternoon.
 *
 *   pnpm --filter @mfp/worker run set:hours        # says what it would write
 *   pnpm --filter @mfp/worker run set:hours -- --yes
 */
import { createPrismaClient } from '@mfp/db/client';
import { GymSettingsSchema } from '@mfp/shared';

const commit = process.argv.includes('--yes');

const need = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
};

/** Monday to Saturday, two sessions each; Sunday closed. */
const HOURS = [
  ...[1, 2, 3, 4, 5, 6].flatMap((day) => [
    { day, open: '04:30', close: '12:00', closed: false },
    { day, open: '17:00', close: '22:00', closed: false },
  ]),
  { day: 0, open: '00:00', close: '00:00', closed: true },
];

async function main(): Promise<void> {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
  const prisma = createPrismaClient({ connectionString: need('DATABASE_URL'), poolMax: 2 });

  try {
    const gym = await prisma.gym.findFirstOrThrow({ select: { id: true, name: true, settings: true } });
    const settings = GymSettingsSchema.parse(gym.settings);

    console.log(`${gym.name}\n`);
    console.log('now:');
    for (const row of settings.hours) console.log(`  day ${row.day}  ${row.closed ? 'closed' : `${row.open} – ${row.close}`}`);
    console.log('\nafter:');
    for (const row of HOURS) console.log(`  day ${row.day}  ${row.closed ? 'closed' : `${row.open} – ${row.close}`}`);

    if (!commit) {
      console.log('\nDry run — nothing was changed. Pass --yes to write it.');
      return;
    }

    // Parsed before writing, so a typo here is refused rather than stored.
    const next = GymSettingsSchema.parse({ ...settings, hours: HOURS });
    await prisma.gym.update({ where: { id: gym.id }, data: { settings: next } });
    console.log('\nWritten.');
  } finally {
    await prisma.$disconnect();
  }
}

await main();
