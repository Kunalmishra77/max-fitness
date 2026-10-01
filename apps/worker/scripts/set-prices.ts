/**
 * The gym's real plan prices and its address (owner, 2026-10-01; ADR-084).
 *
 * What was live were our placeholder figures from the Google listing. The owner has now
 * given the real ones, and corrected the address: "Abhay Khand 1" is not part of it.
 *
 *   pnpm --filter @mfp/worker run set:prices        # says what it would change
 *   pnpm --filter @mfp/worker run set:prices -- --yes
 */
import { createPrismaClient } from '@mfp/db/client';

const commit = process.argv.includes('--yes');

const need = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
};

/** Money is integer paise, everywhere (CLAUDE.md §2.1). */
const PRICES: Readonly<Record<string, number>> = {
  M1_MALE: 150_000,
  M3_MALE: 400_000,
  M6_MALE: 600_000,
  M12_MALE: 1_000_000,
  M1_FEMALE: 120_000,
  M3_FEMALE: 350_000,
  M6_FEMALE: 500_000,
  M12_FEMALE: 800_000,
};

const ADDRESS_LINE = 'Krishan Plaza, Plot No. 6, Nyay Khand I (opposite Sai Mandir)';

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

async function main(): Promise<void> {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
  const prisma = createPrismaClient({ connectionString: need('DATABASE_URL'), poolMax: 2 });

  try {
    const gym = await prisma.gym.findFirstOrThrow({ select: { id: true, name: true, addressLine: true } });
    const plans = await prisma.plan.findMany({ where: { gymId: gym.id }, select: { id: true, code: true, pricePaise: true }, orderBy: { code: 'asc' } });

    console.log(`${gym.name}\n`);
    const changes = plans.filter((plan) => PRICES[plan.code] !== undefined && PRICES[plan.code] !== plan.pricePaise);
    for (const plan of plans) {
      const next = PRICES[plan.code];
      const mark = next === undefined ? '(not in the list)' : next === plan.pricePaise ? 'unchanged' : `→ ${rupees(next)}`;
      console.log(`  ${plan.code.padEnd(12)} ${rupees(plan.pricePaise).padStart(9)}  ${mark}`);
    }
    console.log(`\naddress now:   ${gym.addressLine}`);
    console.log(`address after: ${ADDRESS_LINE}`);

    if (!commit) {
      console.log(`\nDry run — ${changes.length} price${changes.length === 1 ? '' : 's'} would change. Pass --yes.`);
      return;
    }

    for (const plan of changes) {
      const next = PRICES[plan.code];
      if (next !== undefined) await prisma.plan.update({ where: { id: plan.id }, data: { pricePaise: next } });
    }
    await prisma.gym.update({ where: { id: gym.id }, data: { addressLine: ADDRESS_LINE } });
    console.log(`\nWritten: ${changes.length} price${changes.length === 1 ? '' : 's'} and the address.`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
