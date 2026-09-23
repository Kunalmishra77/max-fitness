/**
 * The owner's digest counts and alert queue, against a real database
 * (whatsapp-automation-engine §8).
 *
 * Both are SQL that goes wrong quietly: a digest that counts yesterday's money in
 * UTC would report the wrong number every evening after 5:30, and an alert queue
 * that cannot resolve a row would either say nothing or retry for ever. This pins
 * the boundaries and the resolution.
 *
 * Everything is written under a throwaway gym and deleted afterwards.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import { createPrismaClient, type PrismaClient } from '../src/client';
import { toDbDate } from '../src/dates';
import { PrismaOwnerAlertQueue, PrismaOwnerData } from '../src/repositories/owner.repository';
import { integrationSuite, testDatabaseUrl } from './support';

const run = randomBytes(5).toString('hex');
const gymId = `gym_it_own_${run}`;
const TODAY = istDate('2026-09-23');
const YESTERDAY = istDate('2026-09-22');

const suite = integrationSuite('owner digest and alerts');

suite('owner digest and alerts against Postgres', () => {
  let prisma: PrismaClient;
  let data: PrismaOwnerData;
  let queue: PrismaOwnerAlertQueue;

  async function member(key: string, over: { endDate?: string; dob?: string } = {}): Promise<string> {
    const id = `mem_it_own_${run}_${key}`;
    await prisma.member.create({
      data: {
        id,
        gymId,
        fullName: `Own ${key} Tester`,
        mobile: `+9190002${key.padStart(5, '0')}`,
        ...(over.dob === undefined ? {} : { dob: toDbDate(istDate(over.dob)) }),
        gender: 'FEMALE',
        status: 'ACTIVE',
        source: 'WALK_IN',
        whatsappOptIn: true,
      },
    });
    if (over.endDate !== undefined) {
      await prisma.membership.create({
        data: {
          gymId,
          memberId: id,
          durationMonths: 1,
          startDate: toDbDate(istDate('2026-08-24')),
          endDate: toDbDate(istDate(over.endDate)),
          status: 'CONFIRMED',
          source: 'WALK_IN',
          pricePaise: 150_000,
        },
      });
    }
    return id;
  }

  beforeAll(async () => {
    prisma = createPrismaClient({ connectionString: testDatabaseUrl, poolMax: 4 });
    data = new PrismaOwnerData(prisma);
    queue = new PrismaOwnerAlertQueue(prisma);

    await prisma.gym.create({
      data: { id: gymId, slug: gymId, name: 'Owner test gym', phone: '+919000000008', addressLine: 'Test', city: 'Test', state: 'Test', pincode: '000000', settings: {} },
    });
    await prisma.staffUser.createMany({
      data: [
        { id: `staff_it_own_${run}_r`, gymId, name: 'Reception Person', mobile: '+919000000021', role: 'RECEPTION', pinHash: 'x', language: 'hi' },
        { id: `staff_it_own_${run}_o`, gymId, name: 'Ajay Kuliyal', mobile: '+919000000022', role: 'OWNER', pinHash: 'x', language: 'en' },
      ],
    });
  });

  afterAll(async () => {
    if (prisma === undefined) return;
    await prisma.alert.deleteMany({ where: { gymId } });
    await prisma.messageLog.deleteMany({ where: { gymId } });
    await prisma.callTask.deleteMany({ where: { gymId } });
    await prisma.payment.deleteMany({ where: { gymId } });
    await prisma.lead.deleteMany({ where: { gymId } });
    await prisma.membership.deleteMany({ where: { gymId } });
    await prisma.member.deleteMany({ where: { gymId } });
    await prisma.staffUser.deleteMany({ where: { gymId } });
    await prisma.gym.deleteMany({ where: { id: gymId } });
    await prisma.$disconnect();
  });

  it('picks the owner, not whoever is on the desk', async () => {
    expect(await data.owner(gymId)).toEqual({
      staffUserId: `staff_it_own_${run}_o`,
      // The digest greets "Ajay", not "Ajay Kuliyal".
      firstName: 'Ajay',
      mobile: '+919000000022',
      language: 'en',
    });
  });

  it('counts the day the owner is about to have, without counting anyone twice', async () => {
    // Ending today: counted under "ending today", and not again under "this week".
    const ending = await member('01', { endDate: '2026-09-23', dob: '1990-09-23' });
    await member('02', { endDate: '2026-09-27' });
    await member('03', { endDate: '2026-09-10' });
    await member('04', { dob: '1988-09-23' });

    await prisma.callTask.createMany({
      data: [
        { gymId, memberId: ending, reason: 'DUE_SOON_NO_RESPONSE', priority: 4, status: 'OPEN', dueDate: toDbDate(TODAY) },
        // Due tomorrow: not today's work.
        { gymId, memberId: ending, reason: 'ABSENT_7_DAYS', priority: 5, status: 'OPEN', dueDate: toDbDate(istDate('2026-09-24')) },
        // Already done.
        { gymId, memberId: ending, reason: 'EXPIRED_NOT_RENEWED', priority: 3, status: 'DONE', dueDate: toDbDate(TODAY) },
      ],
    });

    const counts = await data.digestCounts(gymId, TODAY, YESTERDAY);

    expect(counts).toMatchObject({ endingToday: 1, overdue: 1, dueThisWeek: 1, callsToday: 1, birthdays: 2 });
  });

  it('counts yesterday’s money by the IST day, not the UTC one', async () => {
    const payer = await member('05');
    await prisma.payment.createMany({
      data: [
        // 11:30 pm IST yesterday — 6:00 pm UTC, still yesterday either way.
        { gymId, memberId: payer, amountPaise: 100_000, method: 'CASH', status: 'PAID', paidAt: new Date('2026-09-22T18:00:00Z') },
        // 00:30 am IST today — 7:00 pm UTC *yesterday*. A UTC window would count it.
        { gymId, memberId: payer, amountPaise: 7_000, method: 'CASH', status: 'PAID', paidAt: new Date('2026-09-22T19:00:00Z') },
        // 5:00 am IST yesterday, but voided.
        { gymId, memberId: payer, amountPaise: 500_000, method: 'CASH', status: 'VOIDED', paidAt: new Date('2026-09-21T23:30:00Z') },
      ],
    });

    const counts = await data.digestCounts(gymId, TODAY, YESTERDAY);

    expect(counts.collectedYesterdayPaise).toBe(100_000);
  });

  it('turns alert rows into the facts a sentence needs', async () => {
    const payer = await member('06');
    const payment = await prisma.payment.create({
      data: { gymId, memberId: payer, amountPaise: 400_000, method: 'RAZORPAY', status: 'PAID', paidAt: new Date('2026-09-23T04:00:00Z') },
    });
    const lead = await prisma.lead.create({ data: { gymId, name: 'Neha', mobile: '+919876543210', goal: 'Weight loss', source: 'WEBSITE_HERO' } });

    await prisma.alert.createMany({
      data: [
        { gymId, type: 'ONLINE_PAYMENT', memberId: payer, title: 'crm.alerts.onlinePayment', params: { paymentId: payment.id }, createdAt: new Date('2026-09-23T04:01:00Z') },
        { gymId, type: 'NEW_LEAD', title: 'crm.alerts.newLead', params: { leadId: lead.id }, createdAt: new Date('2026-09-23T04:02:00Z') },
        // Nothing to resolve: no payment row behind it.
        { gymId, type: 'ONLINE_PAYMENT', title: 'crm.alerts.onlinePayment', params: { paymentId: 'gone' }, createdAt: new Date('2026-09-23T04:03:00Z') },
      ],
    });

    const { send, drop } = await queue.pending(gymId, new Date('2026-09-23T00:00:00Z'));

    expect(send.map((row) => row.alert)).toEqual([
      { kind: 'ONLINE_PAYMENT', memberName: 'Own 06 Tester', amountPaise: 400_000 },
      { kind: 'NEW_LEAD', name: 'Neha', goal: 'Weight loss', mobile: '+919876543210' },
    ]);
    expect(drop).toHaveLength(1);
  });

  it('drops a backlog older than the caller is willing to send, and forgets nothing twice', async () => {
    await prisma.alert.create({
      data: { gymId, type: 'WHATSAPP_QUALITY', title: 'crm.alerts.whatsappQuality', createdAt: new Date('2026-09-20T04:00:00Z') },
    });

    const first = await queue.pending(gymId, new Date('2026-09-23T00:00:00Z'));
    expect(first.drop.length).toBeGreaterThan(0);

    await queue.markNotified([...first.drop, ...first.send.map((row) => row.id)], new Date('2026-09-23T04:10:00Z'));

    const second = await queue.pending(gymId, new Date('2026-09-23T00:00:00Z'));
    expect(second).toEqual({ send: [], drop: [] });
  });

  it('counts only the alert messages inside the bundling window', async () => {
    await prisma.messageLog.createMany({
      data: [
        { gymId, direction: 'OUTBOUND', purpose: 'OWNER_ALERT', status: 'SENT', idempotencyKey: `it_own_${run}_1`, createdAt: new Date('2026-09-23T04:08:00Z') },
        { gymId, direction: 'OUTBOUND', purpose: 'OWNER_ALERT', status: 'SIMULATED', idempotencyKey: `it_own_${run}_2`, createdAt: new Date('2026-09-23T04:09:00Z') },
        // Refused, so it never reached the owner and must not spend the budget.
        { gymId, direction: 'OUTBOUND', purpose: 'OWNER_ALERT', status: 'FAILED', idempotencyKey: `it_own_${run}_3`, createdAt: new Date('2026-09-23T04:09:30Z') },
        // Before the window.
        { gymId, direction: 'OUTBOUND', purpose: 'OWNER_ALERT', status: 'SENT', idempotencyKey: `it_own_${run}_4`, createdAt: new Date('2026-09-23T04:01:00Z') },
        // A different kind of message entirely.
        { gymId, direction: 'OUTBOUND', purpose: 'REMINDER', status: 'SENT', idempotencyKey: `it_own_${run}_5`, createdAt: new Date('2026-09-23T04:09:00Z') },
      ],
    });

    expect(await queue.sentInWindow(gymId, new Date('2026-09-23T04:05:00Z'))).toBe(2);
  });
});
