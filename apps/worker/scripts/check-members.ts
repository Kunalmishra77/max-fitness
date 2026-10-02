/**
 * What is actually in the register, before anybody deletes any of it.
 *
 * A wipe is irreversible, so this says plainly which rows are real people who signed
 * themselves up and which are leftovers from a test run, and whether any money is attached
 * — because a payment that disappears takes the accounts with it.
 *
 *   pnpm --filter @mfp/worker run check:members
 */
import { createPrismaClient } from '@mfp/db/client';

/** Names written by the integration tests; anything else is assumed to be a real person. */
const TEST_NAME_PATTERNS = [/^Trend \d+$/i, /^Aaaa Stranger$/i, /^Bday /i, /Tester$/i, /^Demo /i];

async function main(): Promise<void> {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL is not set');
  const prisma = createPrismaClient({ connectionString: url, poolMax: 2 });

  try {
    const members = await prisma.member.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        fullName: true,
        memberCode: true,
        status: true,
        source: true,
        createdAt: true,
        _count: { select: { payments: true, memberships: true, attendance: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const paid = await prisma.payment.groupBy({ by: ['memberId'], where: { status: 'PAID' }, _sum: { amountPaise: true } });
    const paidBy = new Map(paid.map((row) => [row.memberId, row._sum.amountPaise ?? 0]));

    const isTest = (name: string) => TEST_NAME_PATTERNS.some((pattern) => pattern.test(name));
    const real = members.filter((m) => !isTest(m.fullName));
    const test = members.filter((m) => isTest(m.fullName));

    const line = (m: (typeof members)[number]) => {
      const money = paidBy.get(m.id) ?? 0;
      return `  ${m.fullName.padEnd(22)} ${(m.memberCode ?? '-').padEnd(8)} ${m.status.padEnd(21)} ${String(m.source).padEnd(12)} payments ${m._count.payments}  paid ₹${(money / 100).toFixed(0)}  visits ${m._count.attendance}`;
    };

    console.log(`REAL PEOPLE (${real.length})`);
    for (const m of real) console.log(line(m));
    console.log(`\nLEFTOVER TEST ROWS (${test.length})`);
    for (const m of test) console.log(line(m));

    const totalPaise = [...paidBy.values()].reduce((sum, value) => sum + value, 0);
    console.log(`\nMoney recorded against members: ₹${(totalPaise / 100).toFixed(0)}`);

    // Whether that money is real is the only question that matters before a wipe: a
    // SIMULATED payment is DEMO_MODE's pretend gateway, and nothing left anybody's pocket.
    const byMethod = await prisma.payment.groupBy({ by: ['method', 'status'], _count: { _all: true }, _sum: { amountPaise: true } });
    for (const row of byMethod) {
      console.log(
        `  ${String(row.method).padEnd(16)} ${String(row.status).padEnd(10)} ${row._count._all} payment(s)  ₹${((row._sum.amountPaise ?? 0) / 100).toFixed(0)}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

await main();
