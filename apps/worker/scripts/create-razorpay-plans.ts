/**
 * Create a Razorpay plan for every plan the gym sells, and record their ids (ADR-105).
 *
 * A Razorpay plan is **immutable**: once created, neither the amount nor the cycle can be
 * changed — only deactivated. So this is written to be run twice safely and to be read
 * before it is run at all:
 *
 *   pnpm --filter @mfp/worker run create:razorpay-plans          # says what it would create
 *   pnpm --filter @mfp/worker run create:razorpay-plans -- --yes
 *
 * **Every plan, not only the monthly ones** (owner, 2026-10-05; ADR-105 §2 revised). A
 * three-month membership that renews itself every three months is the same good deal as a
 * monthly one renewing monthly: the member chose their term, and autopay only means nobody
 * has to chase them at the end of it. Personal training is included for the same reason.
 *
 * Why a script rather than the dashboard: the amount a member is debited and the amount the
 * register shows have to come from one place. Creating sixteen of these by hand means typing
 * sixteen amounts twice and having no way to tell, later, which of the two was wrong.
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

/**
 * Razorpay expresses a cycle as a period plus an interval, and the adapter refuses a month
 * count it has no period for. These four are what the gym sells.
 */
const SUPPORTED_INTERVAL_MONTHS = new Set([1, 3, 6, 12]);

/**
 * What the member reads in their UPI app and on their bank statement, so it has to say which
 * gym and what for, with none of our internal codes in it.
 */
function planLabel(kind: string, months: number, gender: string): string {
  const term = months === 12 ? 'yearly' : months === 1 ? 'monthly' : `${months}-monthly`;
  const who = gender === 'FEMALE' ? 'women' : 'men';
  return kind === 'PT' ? `Max Fitness — personal training, ${term} (${who})` : `Max Fitness — membership, ${term} (${who})`;
}

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
      where: { gymId: gym.id, isActive: true },
      select: { id: true, code: true, kind: true, gender: true, pricePaise: true, providerPlanId: true, durationMonths: true },
      orderBy: [{ kind: 'asc' }, { durationMonths: 'asc' }, { code: 'asc' }],
    });
    if (plans.length === 0) throw new Error(`${gym.name} has no active plan rows`);

    console.log(`${gym.name} (${slug})\n`);
    for (const plan of plans) {
      const state = plan.providerPlanId === null ? 'no Razorpay plan yet' : `already ${plan.providerPlanId}`;
      console.log(`   ${plan.code.padEnd(12)} ${rupees(plan.pricePaise).padStart(9)} / ${String(plan.durationMonths).padStart(2)} month   ${state}`);
    }

    const todo = plans.filter((plan) => plan.providerPlanId === null);
    if (todo.length === 0) {
      console.log('\nEvery plan already has its Razorpay id. Nothing to do.');
      return;
    }
    // Sanity floors, checked before anything immutable is made. A plan created for 1 paise,
    // or on a cycle Razorpay has no period for, cannot be corrected afterwards.
    for (const plan of todo) {
      if (!SUPPORTED_INTERVAL_MONTHS.has(plan.durationMonths)) {
        throw new Error(`${plan.code} is ${plan.durationMonths} months, which has no Razorpay period`);
      }
      if (plan.pricePaise < 10_000) throw new Error(`${plan.code} is ${rupees(plan.pricePaise)}, which is too low to be real`);
    }

    if (!commit) {
      console.log(`\nWould create ${todo.length} Razorpay plan(s):`);
      for (const plan of todo) console.log(`   ${plan.code.padEnd(12)} ${rupees(plan.pricePaise).padStart(9)} every ${plan.durationMonths} month(s)   "${planLabel(plan.kind, plan.durationMonths, plan.gender)}"`);
      console.log('\nA Razorpay plan cannot be edited afterwards. Check the amounts, then re-run with -- --yes');
      return;
    }

    const razorpay = liveRazorpay();
    for (const plan of todo) {
      const created = await razorpay.createPlan({
        name: planLabel(plan.kind, plan.durationMonths, plan.gender),
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
      console.log(`   created ${plan.code.padEnd(12)} ${rupees(created.amountPaise).padStart(9)} every ${plan.durationMonths} month(s) → ${created.providerPlanId}`);
    }

    console.log('\nDone. These ids are now on the gym\'s own plan rows, so the amount a member is debited and the amount the register shows come from one place.');
  } finally {
    await prisma.$disconnect();
  }
}

await main();
