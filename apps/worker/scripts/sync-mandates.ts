/**
 * Ask Razorpay what each unsettled mandate is actually doing, and write it down (ADR-105).
 *
 *   pnpm --filter @mfp/worker run sync:mandates          # says what it would change
 *   pnpm --filter @mfp/worker run sync:mandates -- --yes
 *
 * Webhooks are the normal path and this is the backstop. Two ways it earns its place:
 *
 * **A missed `subscription.activated`.** Until we hear that a member authorised, their
 * mandate stays `CREATED` and the reminder engine keeps chasing the fee — correct, but wrong
 * about this member. Without the event, nothing corrects it until the first debit a month
 * later. One run of this fixes it.
 *
 * **A missed halt.** The dangerous direction: the gym is not being paid while the member
 * still reads as paid up. A halt discovered here raises the same alert, sends the same
 * message and opens the same call task as one that arrived by webhook, because it goes
 * through `updateMandateStatus` rather than writing the row itself.
 *
 * Only unsettled mandates are looked at. A cancelled, completed or expired one has nothing
 * left to tell us, and asking Razorpay about it every night would be a round trip for nothing.
 */
import { mandateStatusFrom, updateMandateStatus } from '@mfp/core';
import { createPrismaClient } from '@mfp/db/client';
import { PrismaMandateStatusUnitOfWork } from '@mfp/db';
import { systemClock } from '@mfp/shared';
import { RazorpayPaymentProvider } from '@mfp/integrations/payments';

const commit = process.argv.includes('--yes');

const need = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
};

/** Nothing more will happen on these, so there is nothing to ask about. */
const SETTLED = ['CANCELLED', 'COMPLETED', 'EXPIRED'] as const;

async function main(): Promise<void> {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
  const prisma = createPrismaClient({ connectionString: need('DATABASE_URL'), poolMax: 2 });
  const razorpay = new RazorpayPaymentProvider({
    keyId: need('RAZORPAY_KEY_ID'),
    keySecret: need('RAZORPAY_KEY_SECRET'),
    webhookSecret: process.env['RAZORPAY_WEBHOOK_SECRET'] ?? '',
  });
  const uow = new PrismaMandateStatusUnitOfWork(prisma);

  try {
    const mandates = await prisma.mandate.findMany({
      where: { status: { notIn: [...SETTLED] } },
      select: {
        id: true,
        providerSubscriptionId: true,
        status: true,
        member: { select: { fullName: true, memberCode: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (mandates.length === 0) {
      console.log('No unsettled mandates. Nothing to ask about.');
      return;
    }
    console.log(`${mandates.length} unsettled mandate(s)\n`);

    let changed = 0;
    for (const mandate of mandates) {
      const who = `${mandate.member.memberCode ?? '—'} ${mandate.member.fullName}`;
      const live = await razorpay.fetchSubscription(mandate.providerSubscriptionId);
      const actual = mandateStatusFrom(live.status);

      if (actual === mandate.status) {
        console.log(`   ${who.padEnd(28)} ${mandate.status} — agrees`);
        continue;
      }
      changed += 1;
      console.log(`   ${who.padEnd(28)} ${mandate.status} → ${actual}${commit ? '' : '   (would change)'}`);
      if (!commit) continue;

      // Through the domain, not a row update: a halt found here must raise the alert, send
      // the message and open the call task exactly as a webhook halt does.
      const result = await updateMandateStatus(
        {
          providerSubscriptionId: mandate.providerSubscriptionId,
          status: actual,
          nextChargeAt: live.chargeAt,
          failureReason: null,
        },
        { clock: systemClock, uow },
      );
      console.log(`      ${result.outcome}`);
    }

    console.log(commit ? `\n${changed} mandate(s) brought up to date.` : `\n${changed} would change. Re-run with -- --yes`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
