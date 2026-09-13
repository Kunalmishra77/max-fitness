/**
 * Database integration tests (testing-strategy.md §1, ADR-010).
 *
 * These need a real, migrated PostgreSQL database — a separate Supabase project
 * locally, or the Postgres 17 service container in CI — named by
 * `TEST_DATABASE_URL`; see `./support.ts`.
 *
 * Every test writes under its own throwaway gym and deletes it afterwards, so the
 * suite is safe to run against a database that also holds other data.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { FEE_STATES, addDays, istDate, type ISTDate } from '@mfp/shared';
import { feeState } from '@mfp/core';
import { createPrismaClient, type PrismaClient } from '../src/client';
import { PrismaMessageLogWriter } from '../src/repositories/message-log.repository';
import { integrationSuite, testDatabaseUrl } from './support';

const suite = integrationSuite('database integration');

/** A fixed business date, so nothing here depends on the wall clock (testing-strategy.md §2). */
const TODAY: ISTDate = istDate('2026-09-10');
const dbDate = (d: ISTDate): Date => new Date(`${d}T00:00:00.000Z`);

suite('database integration', () => {
  let prisma: PrismaClient;
  const gymId = `gym_it_${randomBytes(6).toString('hex')}`;

  beforeAll(async () => {
    prisma = createPrismaClient({ connectionString: testDatabaseUrl, poolMax: 2 });
    await prisma.gym.create({
      data: {
        id: gymId,
        slug: gymId,
        name: 'Integration test gym',
        phone: '+919000000009',
        addressLine: 'Test',
        city: 'Test',
        state: 'Test',
        pincode: '000000',
        settings: {},
      },
    });
  });

  afterAll(async () => {
    if (prisma === undefined) return;
    await prisma.callTask.deleteMany({ where: { gymId } });
    await prisma.messageLog.deleteMany({ where: { gymId } });
    await prisma.membership.deleteMany({ where: { gymId } });
    await prisma.member.deleteMany({ where: { gymId } });
    await prisma.gym.deleteMany({ where: { id: gymId } });
    await prisma.$disconnect();
  });

  const createMember = async (suffix: string): Promise<string> => {
    const id = `${gymId}_m_${suffix}`;
    await prisma.member.create({
      data: { id, gymId, fullName: `Member ${suffix}`, mobile: '+919000010001', gender: 'MALE', status: 'ACTIVE', source: 'CRM' },
    });
    return id;
  };

  it('enables RLS on every table in public, including Prisma’s own (ADR-011)', async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity ORDER BY tablename
    `;
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it('member_fee_at() agrees with the canonical core feeState() for contiguous memberships (ADR-013)', async () => {
    // One member per fee state, plus an early renewal (upcoming membership starting the day after).
    const fixtures: Array<{ key: string; periods: Array<[ISTDate, ISTDate]> }> = [
      { key: 'paid', periods: [[addDays(TODAY, -10), addDays(TODAY, 20)]] },
      { key: 'duesoon', periods: [[addDays(TODAY, -25), addDays(TODAY, 3)]] },
      { key: 'today', periods: [[addDays(TODAY, -29), TODAY]] },
      { key: 'expired', periods: [[addDays(TODAY, -40), addDays(TODAY, -5)]] },
      { key: 'renewed', periods: [[addDays(TODAY, -28), addDays(TODAY, 2)], [addDays(TODAY, 3), addDays(TODAY, 33)]] },
      { key: 'none', periods: [] },
    ];

    const expected = new Map<string, string>();
    for (const f of fixtures) {
      const memberId = await createMember(f.key);
      const ms = f.periods.map(([start, end], i) => ({ id: `${memberId}_ms${i}`, startDate: start, endDate: end }));
      if (ms.length > 0) {
        await prisma.membership.createMany({
          data: ms.map((m) => ({
            id: m.id,
            gymId,
            memberId,
            startDate: dbDate(m.startDate),
            endDate: dbDate(m.endDate),
            status: 'CONFIRMED' as const,
            source: 'CRM' as const,
          })),
        });
      }
      expected.set(memberId, feeState(TODAY, ms.map((m) => ({ ...m, status: 'CONFIRMED' as const }))).feeState);
    }

    const rows = await prisma.$queryRaw<Array<{ memberId: string; feeState: string }>>`
      SELECT "memberId", "feeState" FROM "member_fee_at"(${TODAY}::date) WHERE "gymId" = ${gymId}
    `;
    const actual = new Map(rows.map((r) => [r.memberId, r.feeState]));

    for (const [memberId, state] of expected) {
      expect(FEE_STATES).toContain(state);
      expect(actual.get(memberId), memberId).toBe(state);
    }
  });

  it('documents the one known divergence: the SQL read model extends across a gap, core does not (ADR-014)', async () => {
    const memberId = await createMember('gap');
    await prisma.membership.createMany({
      data: [
        { id: `${memberId}_old`, gymId, memberId, startDate: dbDate(addDays(TODAY, -120)), endDate: dbDate(addDays(TODAY, -90)), status: 'CONFIRMED', source: 'CRM' },
        { id: `${memberId}_future`, gymId, memberId, startDate: dbDate(addDays(TODAY, 100)), endDate: dbDate(addDays(TODAY, 130)), status: 'CONFIRMED', source: 'CRM' },
      ],
    });

    const [row] = await prisma.$queryRaw<Array<{ feeState: string }>>`
      SELECT "feeState" FROM "member_fee_at"(${TODAY}::date) WHERE "memberId" = ${memberId}
    `;
    const core = feeState(TODAY, [
      { id: 'old', startDate: addDays(TODAY, -120), endDate: addDays(TODAY, -90), status: 'CONFIRMED' },
      { id: 'future', startDate: addDays(TODAY, 100), endDate: addDays(TODAY, 130), status: 'CONFIRMED' },
    ]);

    // If this starts failing because the view now agrees with core, the view was fixed:
    // update ADR-014 and turn this into a parity assertion.
    expect(row?.feeState).toBe('PAID');
    expect(core.feeState).toBe('EXPIRED');
  });

  it('records a message-log idempotency key exactly once (BR-5.4, case R15)', async () => {
    const writer = new PrismaMessageLogWriter(prisma);
    const entry = {
      gymId,
      memberId: null,
      membershipId: null,
      direction: 'OUTBOUND' as const,
      purpose: 'REMINDER' as const,
      ruleCode: 'PRE_7',
      templateName: 'mf_renewal_due' as const,
      language: 'hi' as const,
      toNumber: null,
      idempotencyKey: `rem:${gymId}:m:ms:PRE_7:${TODAY}:10:00`,
      providerMessageId: null,
      status: 'SIMULATED' as const,
      bodyPreview: null,
      payload: { variables: { firstName: 'Test' } },
    };

    const [first, second] = [await writer.record(entry), await writer.record(entry)];
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(await prisma.messageLog.count({ where: { idempotencyKey: entry.idempotencyKey } })).toBe(1);
  });

  it('allows only one OPEN call task per member and reason, but any number of closed ones (BR-7)', async () => {
    const memberId = await createMember('calls');
    const task = (id: string, status: 'OPEN' | 'DONE') => ({
      id: `${memberId}_${id}`,
      gymId,
      memberId,
      reason: 'EXPIRED_NOT_RENEWED' as const,
      priority: 3,
      status,
      dueDate: dbDate(TODAY),
    });

    await prisma.callTask.create({ data: task('open1', 'OPEN') });
    await prisma.callTask.create({ data: task('done1', 'DONE') });
    await prisma.callTask.create({ data: task('done2', 'DONE') });
    await expect(prisma.callTask.create({ data: task('open2', 'OPEN') })).rejects.toThrow();
  });

  it('rejects a non-positive payment amount at the database (money CHECK constraint)', async () => {
    const memberId = await createMember('pay');
    await expect(
      prisma.payment.create({
        data: { id: `${memberId}_p`, gymId, memberId, amountPaise: 0, method: 'CASH', status: 'PAID' },
      }),
    ).rejects.toThrow();
  });
});
