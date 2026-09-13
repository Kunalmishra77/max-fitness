/**
 * The outbox claim against a real database (system-architecture.md §5).
 *
 * Proves what only PostgreSQL can: that claiming hides events from a second poller
 * (`FOR UPDATE SKIP LOCKED` plus a lease), so two worker processes never dispatch the
 * same event, and that retries and failures are recorded.
 *
 * Events use a run-unique type, so the test never claims real pending events in a shared
 * database, and everything is deleted afterwards.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { OutboxEventType } from '@mfp/core';
import { createPrismaClient, type PrismaClient } from '../src/client';
import { PrismaOutboxDispatchStore } from '../src/repositories/outbox-dispatch.repository';
import { integrationSuite, testDatabaseUrl } from './support';

const run = randomBytes(5).toString('hex');
const gymId = `gym_it_outbox_${run}`;
const TYPE = `test.outbox.${run}` as OutboxEventType;
const OTHER_TYPE = `test.other.${run}` as OutboxEventType;

const suite = integrationSuite('outbox claim');

suite('outbox dispatch store', () => {
  let prisma: PrismaClient;
  let store: PrismaOutboxDispatchStore;

  beforeAll(async () => {
    prisma = createPrismaClient({ connectionString: testDatabaseUrl, poolMax: 4 });
    store = new PrismaOutboxDispatchStore(prisma);
    await prisma.gym.create({
      data: { id: gymId, slug: gymId, name: 'Outbox test gym', phone: '+919000000009', addressLine: 'Test', city: 'Test', state: 'Test', pincode: '000000', settings: {} },
    });
  });

  afterAll(async () => {
    if (prisma === undefined) return;
    await prisma.outboxEvent.deleteMany({ where: { gymId } });
    await prisma.gym.deleteMany({ where: { id: gymId } });
    await prisma.$disconnect();
  });

  const seed = (count: number, type: OutboxEventType, availableAt: Date) =>
    prisma.outboxEvent.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        gymId,
        type,
        payload: { n: i },
        dedupeKey: `${type}:${availableAt.getTime()}:${i}`,
        availableAt: new Date(availableAt.getTime() + i),
      })),
    });

  it('claims due events of the requested types, oldest first, and hides them for the lease', async () => {
    const now = new Date('2026-09-11T10:00:00Z');
    await seed(3, TYPE, new Date('2026-09-11T09:00:00Z'));
    await seed(1, OTHER_TYPE, new Date('2026-09-11T09:00:00Z'));
    await seed(1, TYPE, new Date('2026-09-11T11:00:00Z')); // not yet due

    const first = await store.claimDue([TYPE], now, 2, 60_000);
    expect(first.map((e) => e.payload)).toEqual([{ n: 0 }, { n: 1 }]);
    expect(first.every((e) => e.type === TYPE && e.gymId === gymId && e.attempts === 0)).toBe(true);

    const second = await store.claimDue([TYPE], now, 10, 60_000);
    expect(second.map((e) => e.payload)).toEqual([{ n: 2 }]);

    // After the lease a crashed worker's claim comes back.
    const later = await store.claimDue([TYPE], new Date(now.getTime() + 61_000), 10, 60_000);
    expect(later.map((e) => e.payload)).toEqual([{ n: 0 }, { n: 1 }, { n: 2 }]);
  });

  it('never gives the same event to two pollers claiming at once', async () => {
    const type = `${TYPE}.race` as OutboxEventType;
    const now = new Date('2026-09-11T10:00:00Z');
    await seed(6, type, new Date('2026-09-11T09:30:00Z'));

    const [a, b] = await Promise.all([store.claimDue([type], now, 6, 60_000), store.claimDue([type], now, 6, 60_000)]);

    const ids = [...a, ...b].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6);
  });

  it('records dispatch, retry and failure', async () => {
    const type = `${TYPE}.states` as OutboxEventType;
    const now = new Date('2026-09-11T10:00:00Z');
    await seed(3, type, new Date('2026-09-11T09:45:00Z'));
    const [ok, retry, failed] = await store.claimDue([type], now, 3, 60_000);
    if (ok === undefined || retry === undefined || failed === undefined) throw new Error('expected three events');

    await store.markDispatched(ok.id, now);
    await store.scheduleRetry(retry.id, 1, 'Error', new Date('2026-09-11T10:00:30Z'));
    await store.markFailed(failed.id, 6, 'PAYMENT_NOT_FOUND');

    const rows = await prisma.outboxEvent.findMany({
      where: { id: { in: [ok.id, retry.id, failed.id] } },
      select: { id: true, status: true, attempts: true, lastError: true, availableAt: true, dispatchedAt: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(ok.id)).toMatchObject({ status: 'DISPATCHED', dispatchedAt: now });
    expect(byId.get(retry.id)).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'Error', availableAt: new Date('2026-09-11T10:00:30Z') });
    expect(byId.get(failed.id)).toMatchObject({ status: 'FAILED', attempts: 6, lastError: 'PAYMENT_NOT_FOUND' });
  });
});
