/**
 * Create this gym's personal-training plans at the owner's quoted prices (ADR-087).
 *
 * The eight rows — four terms × two price lists — are what the PT price list, the sign-up
 * question and the CRM's PT section all read. The same price for men and women today; a
 * row each anyway, so splitting them later is a price change and no new code.
 *
 *   pnpm --filter @mfp/worker run set:pt        # says what it would create
 *   pnpm --filter @mfp/worker run set:pt -- --yes
 */
import { DEFAULT_PT_PRICES_PAISE, PLAN_DURATIONS, PRICED_GENDERS, ptPlanCode } from '@mfp/shared';
import { createPrismaClient } from '@mfp/db/client';

const commit = process.argv.includes('--yes');

const need = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
};

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

const WANTED = PRICED_GENDERS.flatMap((gender) =>
  PLAN_DURATIONS.map((months) => ({
    code: ptPlanCode(months, gender),
    gender,
    durationMonths: months,
    pricePaise: DEFAULT_PT_PRICES_PAISE[months],
  })),
);

async function main(): Promise<void> {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
  const prisma = createPrismaClient({ connectionString: need('DATABASE_URL'), poolMax: 2 });

  try {
    const gym = await prisma.gym.findFirstOrThrow({ select: { id: true, name: true } });
    const existing = new Map(
      (await prisma.plan.findMany({ where: { gymId: gym.id, kind: 'PT' }, select: { code: true, pricePaise: true } })).map((plan) => [
        plan.code,
        plan.pricePaise,
      ]),
    );

    console.log(`${gym.name}\n`);
    const toCreate = WANTED.filter((plan) => !existing.has(plan.code));
    const toReprice = WANTED.filter((plan) => existing.has(plan.code) && existing.get(plan.code) !== plan.pricePaise);

    for (const plan of WANTED) {
      const was = existing.get(plan.code);
      const perMonth = rupees(Math.round(plan.pricePaise / plan.durationMonths));
      const mark = was === undefined ? 'create' : was === plan.pricePaise ? 'unchanged' : `${rupees(was)} →`;
      console.log(`  ${plan.code.padEnd(13)} ${mark.padStart(12)} ${rupees(plan.pricePaise).padStart(9)}  (${perMonth}/month)`);
    }

    if (!commit) {
      console.log(`\nDry run — ${toCreate.length} to create, ${toReprice.length} to reprice. Pass --yes.`);
      return;
    }

    for (const plan of toCreate) {
      await prisma.plan.create({
        data: {
          gymId: gym.id,
          code: plan.code,
          kind: 'PT',
          durationMonths: plan.durationMonths,
          gender: plan.gender,
          pricePaise: plan.pricePaise,
          isActive: true,
          sortOrder: plan.durationMonths,
        },
      });
    }
    for (const plan of toReprice) {
      await prisma.plan.update({ where: { gymId_code: { gymId: gym.id, code: plan.code } }, data: { pricePaise: plan.pricePaise } });
    }
    console.log(`\nWritten: ${toCreate.length} created, ${toReprice.length} repriced.`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
