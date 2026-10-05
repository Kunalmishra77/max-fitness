import { randomUUID } from 'node:crypto';
import type {
  MandateChargeStore,
  MandateChargeUnitOfWork,
  MandateForCharge,
  MandateForStatus,
  MandateStatusStore,
  MandateStatusUnitOfWork,
  StartMandateStore,
  StartMandateUnitOfWork,
} from '@mfp/core';
import { MembershipSettingsSchema } from '@mfp/shared';
import { fromDbDate, toDbDate } from '../dates';
import { withTransaction, type PrismaClient, type TransactionClient } from '../client';
import { enqueueOutboxEvent } from './outbox';

/**
 * Prisma implementation of the mandate flows (ADR-105).
 *
 * The row lock is what carries correctness, as it does for payments. `subscription.charged`
 * and `subscription.halted` can arrive within milliseconds of each other, and Razorpay
 * re-delivers freely; `FOR UPDATE` on the mandate makes the second one wait for the first to
 * commit, so it reads the state the first one left rather than the state before it.
 *
 * `status` is cast to text in the raw queries because the generated enum type and the driver
 * adapter do not agree about Postgres enums — the same reason `check:rls` casts `relkind`.
 */

/** The statuses money can still arrive on (ADR-105 §5). */
const LIVE_STATUSES = ['ACTIVE', 'AUTHENTICATED', 'PENDING', 'CREATED'] as const;

export class PrismaMandateChargeUnitOfWork implements MandateChargeUnitOfWork {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  transaction<T>(work: (store: MandateChargeStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(chargeStoreFor(tx)));
  }
}

function chargeStoreFor(tx: TransactionClient): MandateChargeStore {
  return {
    async lockMandateBySubscriptionId(providerSubscriptionId) {
      const rows = await tx.$queryRaw<MandateForCharge[]>`
        SELECT "id", "gymId", "memberId", "planId", "amountPaise", "intervalMonths", "status"::text AS "status"
        FROM "Mandate"
        WHERE "providerSubscriptionId" = ${providerSubscriptionId}
        FOR UPDATE
      `;
      return rows[0] ?? null;
    },

    findPaymentByProviderPaymentId(providerPaymentId) {
      return tx.payment.findUnique({ where: { providerPaymentId }, select: { id: true, receiptNo: true } });
    },

    async gymSettings(gymId) {
      const gym = await tx.gym.findUnique({ where: { id: gymId }, select: { settings: true } });
      const membership = (gym?.settings as { membership?: unknown } | null)?.membership;
      // Parsed through the schema rather than read field by field, so the default for
      // `renewalGraceDays` comes from the one place that defines it (BR-3.4).
      const parsed = MembershipSettingsSchema.safeParse(membership ?? {});
      return { renewalGraceDays: parsed.success ? parsed.data.renewalGraceDays : MembershipSettingsSchema.parse({}).renewalGraceDays };
    },

    async nextCounterValue(gymId, key) {
      const rows = await tx.$queryRaw<Array<{ value: number }>>`
        INSERT INTO "Counter" ("id", "gymId", "key", "value")
        VALUES (${randomUUID()}, ${gymId}, ${key}, 1)
        ON CONFLICT ("gymId", "key") DO UPDATE SET "value" = "Counter"."value" + 1
        RETURNING "value"
      `;
      const value = rows[0]?.value;
      if (value === undefined) throw new Error('Counter upsert returned no row');
      return value;
    },

    async latestMembershipEndDate(memberId) {
      const latest = await tx.membership.findFirst({
        where: { memberId, status: 'CONFIRMED' },
        orderBy: { endDate: 'desc' },
        select: { endDate: true },
      });
      return latest === null ? null : fromDbDate(latest.endDate);
    },

    async createMembership(input) {
      const created = await tx.membership.create({
        data: {
          gymId: input.gymId,
          memberId: input.memberId,
          planId: input.planId,
          durationMonths: input.durationMonths,
          startDate: toDbDate(input.startDate),
          endDate: toDbDate(input.endDate),
          pricePaise: input.pricePaise,
          status: input.status,
          source: input.source,
          confirmedAt: input.confirmedAt,
        },
        select: { id: true },
      });
      return created;
    },

    async createMandatePayment(input) {
      const created = await tx.payment.create({
        data: {
          gymId: input.gymId,
          memberId: input.memberId,
          membershipId: input.membershipId,
          mandateId: input.mandateId,
          amountPaise: input.amountPaise,
          method: input.method,
          status: input.status,
          receiptNo: input.receiptNo,
          providerPaymentId: input.providerPaymentId,
          providerSignatureOk: input.providerSignatureOk,
          paidAt: input.paidAt,
        },
        select: { id: true },
      });
      return created;
    },

    async markMandateCharged(mandateId, update) {
      await tx.mandate.update({
        where: { id: mandateId },
        data: {
          status: update.status,
          lastChargedAt: update.lastChargedAt,
          nextChargeOn: update.nextChargeOn === null ? null : toDbDate(update.nextChargeOn),
          chargeCount: { increment: 1 },
          // A debit that succeeded makes the last failure no longer a description of this
          // mandate — and a halted one that charges again is live again.
          failureReason: null,
          haltedAt: null,
        },
      });
    },

    getMember(memberId) {
      return tx.member.findUniqueOrThrow({ where: { id: memberId }, select: { id: true, memberCode: true } });
    },

    async activateMember(memberId, memberCode) {
      await tx.member.update({
        where: { id: memberId },
        // The same rule a counter payment follows (BR-4.4): a member who left and paid again
        // is back, and clearing `leftAt` stops the retention sweep deleting their photo.
        data: { status: 'ACTIVE', memberCode, leftAt: null, leftReason: null },
      });
    },

    async closeOpenCallTasks(memberId, reasons, closedAt) {
      await tx.callTask.updateMany({
        where: { memberId, status: 'OPEN', reason: { in: [...reasons] } },
        data: { status: 'AUTO_CLOSED', doneAt: closedAt },
      });
    },

    async createAlert(alert) {
      await tx.alert.create({
        data: { gymId: alert.gymId, type: alert.type, memberId: alert.memberId, title: alert.title, params: { ...alert.params } },
      });
    },

    enqueueOutbox(event) {
      return enqueueOutboxEvent(tx, event);
    },
  };
}

export class PrismaMandateStatusUnitOfWork implements MandateStatusUnitOfWork {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  transaction<T>(work: (store: MandateStatusStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(statusStoreFor(tx)));
  }
}

function statusStoreFor(tx: TransactionClient): MandateStatusStore {
  return {
    async lockMandateBySubscriptionId(providerSubscriptionId) {
      const rows = await tx.$queryRaw<MandateForStatus[]>`
        SELECT "id", "gymId", "memberId", "status"::text AS "status", "authorisedAt"
        FROM "Mandate"
        WHERE "providerSubscriptionId" = ${providerSubscriptionId}
        FOR UPDATE
      `;
      return rows[0] ?? null;
    },

    async patchMandate(mandateId, patch) {
      await tx.mandate.update({
        where: { id: mandateId },
        data: {
          status: patch.status,
          ...(patch.authorisedAt === undefined ? {} : { authorisedAt: patch.authorisedAt }),
          ...(patch.nextChargeOn === undefined ? {} : { nextChargeOn: patch.nextChargeOn === null ? null : toDbDate(patch.nextChargeOn) }),
          ...(patch.haltedAt === undefined ? {} : { haltedAt: patch.haltedAt }),
          ...(patch.cancelledAt === undefined ? {} : { cancelledAt: patch.cancelledAt }),
          ...(patch.failureReason === undefined ? {} : { failureReason: patch.failureReason }),
        },
      });
    },

    async createAlert(alert) {
      await tx.alert.create({
        data: { gymId: alert.gymId, type: alert.type, memberId: alert.memberId, title: alert.title, params: { ...alert.params } },
      });
    },

    async openCallTask(task) {
      const member = await tx.member.findUniqueOrThrow({ where: { id: task.memberId }, select: { gymId: true } });
      // `skipDuplicates` against the partial unique index "one OPEN task per member and
      // reason" (database-design.md §3), so a lost race is a no-op rather than an error —
      // the same way the nightly job creates its tasks.
      await tx.callTask.createMany({
        data: [
          {
            gymId: member.gymId,
            memberId: task.memberId,
            reason: task.reason,
            priority: task.priority,
            dueDate: toDbDate(task.dueDate),
            status: 'OPEN',
          },
        ],
        skipDuplicates: true,
      });
    },

    enqueueOutbox(event) {
      return enqueueOutboxEvent(tx, event);
    },
  };
}

export class PrismaStartMandateUnitOfWork implements StartMandateUnitOfWork {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  transaction<T>(work: (store: StartMandateStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(startStoreFor(tx)));
  }
}

function startStoreFor(tx: TransactionClient): StartMandateStore {
  return {
    async findCandidate(input) {
      const member = await tx.member.findFirst({
        where: { id: input.memberId, gymId: input.gymId, deletedAt: null },
        select: {
          id: true,
          gymId: true,
          gender: true,
          memberships: {
            where: { status: 'CONFIRMED' },
            orderBy: { endDate: 'desc' },
            take: 1,
            select: { endDate: true, planId: true },
          },
          mandates: {
            where: { status: { in: [...LIVE_STATUSES] } },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, status: true, shortUrl: true, nextChargeOn: true },
          },
        },
      });
      if (member === null) return null;

      // Which plan the mandate charges for: an explicitly chosen one, the plan the member's
      // latest membership was on, or — for a member whose history predates this system and
      // has no plan recorded — the monthly plan for their gender.
      const plan =
        input.planId !== undefined
          ? await tx.plan.findFirst({ where: { id: input.planId, gymId: input.gymId }, select: PLAN_FIELDS })
          : ((member.memberships[0]?.planId ?? null) !== null
              ? await tx.plan.findFirst({ where: { id: member.memberships[0]?.planId ?? '', gymId: input.gymId }, select: PLAN_FIELDS })
              : await tx.plan.findFirst({
                  where: { gymId: input.gymId, kind: 'MEMBERSHIP', durationMonths: 1, gender: member.gender, isActive: true },
                  select: PLAN_FIELDS,
                }));
      if (plan === null || plan === undefined) return null;

      const live = member.mandates[0];
      return {
        memberId: member.id,
        gymId: member.gymId,
        planId: plan.id,
        planCode: plan.code,
        pricePaise: plan.pricePaise,
        durationMonths: plan.durationMonths,
        providerPlanId: plan.providerPlanId,
        coveredUntil: member.memberships[0] === undefined ? null : fromDbDate(member.memberships[0].endDate),
        liveMandate:
          live === undefined
            ? null
            : {
                id: live.id,
                status: live.status,
                shortUrl: live.shortUrl,
                nextChargeOn: live.nextChargeOn === null ? null : fromDbDate(live.nextChargeOn),
              },
      };
    },

    async createMandate(record) {
      const created = await tx.mandate.create({
        data: {
          gymId: record.gymId,
          memberId: record.memberId,
          planId: record.planId,
          providerSubscriptionId: record.providerSubscriptionId,
          providerPlanId: record.providerPlanId,
          status: record.status,
          amountPaise: record.amountPaise,
          intervalMonths: record.intervalMonths,
          shortUrl: record.shortUrl,
          nextChargeOn: record.nextChargeOn === null ? null : toDbDate(record.nextChargeOn),
        },
        select: { id: true },
      });
      return created;
    },

    enqueueOutbox(event) {
      return enqueueOutboxEvent(tx, event);
    },
  };
}

const PLAN_FIELDS = { id: true, code: true, pricePaise: true, durationMonths: true, providerPlanId: true } as const;
