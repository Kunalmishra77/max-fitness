/**
 * Create the gym's monthly plans at Razorpay and record their ids (ADR-105).
 *
 * A Razorpay plan is **immutable**: once created, neither the amount nor the cycle can be
 * changed — only deactivated. So this is written to be run twice safely and to be read
 * before it is run at all:
 *
 *   pnpm --filter @mfp/worker run create:razorpay-plans          # says what it would create
 *   pnpm --filter @mfp/worker run create:razorpay-plans -- --yes
 *
 * Monthly only, on purpose. The 3, 6 and 12-month plans are prepaid lump sums; a standing
 * instruction for one of those is a different product than the gym sells (ADR-105 §2).
 *
 * Why a script rather than the dashboard: the amount a member is debited and the amount the
 * register shows have to come from one place. Creating these by hand means typing ₹1,500
 * twice and having no way to tell, later, which of the two was wrong.
 */
import { createPrismaClient } from '@mfp/db/client';
import { RazorpayPaymentProvider } from '@mfp/integrations/payments';

const commit = process.argv.includes('--yes');

const need = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
};

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

/** Only the one-month rows get a Razorpay plan. */
const AUTOPAY_PLAN_CODES = ['M1_MALE', 'M1_FEMALE'] as const;

async function main(): Promise<void> {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
  const prisma = createPrismaClient({ connectionString: need('DATABASE_URL'), poolMax: 2 });

  // The credentials are read only when something is actually going to be created. A dry run
  // is a database question — which plans lack a Razorpay id, and at what price — and it must
  // be answerable from a machine that has no live payment keys, because this one does not:
  // the live credentials went straight into the host's environment and never into `.env`.
  const liveRazorpay = () =>
    new RazorpayPaymentProvider({
      keyId: need('RAZORPAY_KEY_ID'),
      keySecret: need('RAZORPAY_KEY_SECRET'),
      // Not used by any call here; the provider takes one configuration object.
      webhookSecret: process.env['RAZORPAY_WEBHOOK_SECRET'] ?? '',
    });

  // By slug, not `findFirst`: a stray test row must never be the one that gets edited
  // (ADR-102 §4).
  const slug = process.env['GYM_SLUG'] ?? 'max-fitness-indirapuram';

  try {
    const gym = await prisma.gym.findUnique({ where: { slug }, select: { id: true, name: true } });
    if (gym === null) throw new Error(`No gym with slug "${slug}"`);

    const plans = await prisma.plan.findMany({
      where: { gymId: gym.id, code: { in: [...AUTOPAY_PLAN_CODES] }, kind: 'MEMBERSHIP' },
      select: { id: true, code: true, pricePaise: true, providerPlanId: true, durationMonths: true, isActive: true },
      orderBy: { code: 'asc' },
    });

    const missing = AUTOPAY_PLAN_CODES.filter((code) => !plans.some((plan) => plan.code === code));
    if (missing.length > 0) throw new Error(`${gym.name} has no plan row for ${missing.join(', ')}`);

    console.log(`${gym.name} (${slug})\n`);
    for (const plan of plans) {
      const state = plan.providerPlanId === null ? 'no Razorpay plan yet' : `already ${plan.providerPlanId}`;
      console.log(`   ${plan.code.padEnd(10)} ${rupees(plan.pricePaise).padStart(8)} / ${plan.durationMonths} month   ${state}`);
    }

    const todo = plans.filter((plan) => plan.providerPlanId === null);
    if (todo.length === 0) {
      console.log('\nEvery autopay plan already has its Razorpay id. Nothing to do.');
      return;
    }
    // A sanity floor. A plan created for 1 paise is immutable and embarrassing.
    for (const plan of todo) {
      if (plan.durationMonths !== 1) throw new Error(`${plan.code} is ${plan.durationMonths} months; autopay is monthly only`);
      if (plan.pricePaise < 10_000) throw new Error(`${plan.code} is ${rupees(plan.pricePaise)}, which is too low to be real`);
    }

    if (!commit) {
      console.log(`\nWould create ${todo.length} Razorpay plan(s): ${todo.map((p) => `${p.code} at ${rupees(p.pricePaise)}/month`).join(', ')}`);
      console.log('A Razorpay plan cannot be edited afterwards. Check the amounts, then re-run with -- --yes');
      return;
    }

    const razorpay = liveRazorpay();
    for (const plan of todo) {
      const label = plan.code.endsWith('_FEMALE') ? 'Max Fitness — monthly (women)' : 'Max Fitness — monthly (men)';
      const created = await razorpay.createPlan({
        name: label,
        amountPaise: plan.pricePaise,
        intervalMonths: plan.durationMonths,
        notes: { planCode: plan.code, gymSlug: slug },
      });

      // Razorpay echoes the amount back. If it disagrees with what we asked for, the plan is
      // wrong and immutable, and the id must not be recorded against this row.
      if (created.amountPaise !== plan.pricePaise) {
        throw new Error(`Razorpay created ${plan.code} at ${rupees(created.amountPaise)}, not ${rupees(plan.pricePaise)}. Plan ${created.providerPlanId} is wrong — deactivate it in the dashboard.`);
      }

      await prisma.plan.update({ where: { id: plan.id }, data: { providerPlanId: created.providerPlanId } });
      console.log(`   created ${plan.code} at ${rupees(created.amountPaise)}/month → ${created.providerPlanId}`);
    }

    console.log('\nDone. These ids are now on the gym\'s own plan rows, so the amount a member is debited and the amount the register shows come from one place.');
  } finally {
    await prisma.$disconnect();
  }
}

await main();
