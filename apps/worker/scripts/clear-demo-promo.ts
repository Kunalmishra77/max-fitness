/**
 * Take the seeded DEMO offer off the public site (owner, 2026-10-01; ADR-084).
 *
 * The plans section was showing "DEMO — Free fitness assessment with any 3-month plan",
 * which is our placeholder, on a site the gym's own members now read. The owner has not
 * given a real offer, so the banner is switched off rather than filled with an invented
 * one: no promotion is honest, a made-up promotion is not.
 *
 * When they do have an offer, it is typed into Max Register → Settings; nothing here
 * needs running again.
 *
 *   pnpm --filter @mfp/worker run clear:demo-promo
 *   pnpm --filter @mfp/worker run clear:demo-promo -- --yes
 */
import { createPrismaClient } from '@mfp/db/client';
import { GymSettingsSchema } from '@mfp/shared';

const commit = process.argv.includes('--yes');

async function main(): Promise<void> {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL is not set');
  const prisma = createPrismaClient({ connectionString: url, poolMax: 2 });

  try {
    const gym = await prisma.gym.findFirstOrThrow({ select: { id: true, name: true, settings: true } });
    const settings = GymSettingsSchema.parse(gym.settings);

    console.log(`${gym.name}\n`);
    console.log(`banner now:   ${settings.promo.enabled ? 'on' : 'off'} — ${settings.promo.textEn || '(no text)'}`);
    console.log(`bar now:      ${settings.promo.barEnabled ? 'on' : 'off'} — ${settings.promo.barTextEn || '(no text)'}`);
    console.log('after:        both off, no text');

    if (!commit) {
      console.log('\nDry run — nothing was changed. Pass --yes.');
      return;
    }

    const next = GymSettingsSchema.parse({
      ...settings,
      promo: { ...settings.promo, enabled: false, barEnabled: false, textEn: '', textHi: '', barTextEn: '', barTextHi: '' },
    });
    await prisma.gym.update({ where: { id: gym.id }, data: { settings: next } });
    console.log('\nWritten.');
  } finally {
    await prisma.$disconnect();
  }
}

await main();
