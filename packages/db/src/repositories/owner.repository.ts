import type { OwnerAlert, OwnerDigestCounts, PendingOwnerAlert } from '@mfp/core';
import type { ISTDate, Language } from '@mfp/shared';
import type { PrismaClient } from '../client';

/**
 * What the owner is told, and who to tell (whatsapp-automation-engine §8).
 *
 * The digest counts come from the same `member_fee_at` read model the CRM home
 * screen reads, so the WhatsApp and the screen can never disagree by a member.
 *
 * Alerts are the rows the app already writes in the same transaction as the thing
 * that happened — an `Alert` row is the durable record that the owner should hear
 * about it (ADR-065). This repository turns those rows into the facts a sentence
 * needs, and stamps them once they have been sent.
 */

interface FeeRow {
  memberId: string;
  feeState: string;
  daysLeft: number | null;
}

export interface OwnerRecipient {
  readonly staffUserId: string;
  readonly firstName: string;
  readonly mobile: string;
  readonly language: Language;
}

export class PrismaOwnerData {
  readonly #prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  /** The owner the digest and alerts go to; null when the gym has no active owner. */
  async owner(gymId: string): Promise<OwnerRecipient | null> {
    const staff = await this.#prisma.staffUser.findFirst({
      where: { gymId, role: 'OWNER', isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, mobile: true, language: true },
    });
    if (staff === null) return null;
    return {
      staffUserId: staff.id,
      firstName: staff.name.trim().split(/\s+/)[0] ?? staff.name,
      mobile: staff.mobile,
      language: staff.language,
    };
  }

  /** The seven numbers of the 08:30 digest. */
  async digestCounts(gymId: string, today: ISTDate, yesterday: ISTDate): Promise<OwnerDigestCounts> {
    const [day, month] = [Number(today.slice(8, 10)), Number(today.slice(5, 7))];

    const [fees, callsToday, birthdays, collected] = await Promise.all([
      this.#prisma.$queryRaw<FeeRow[]>`
        SELECT "memberId", "feeState", "daysLeft"
        FROM "member_fee_at"(${today}::date)
        WHERE "gymId" = ${gymId}
      `,
      this.#prisma.callTask.count({ where: { gymId, status: 'OPEN', dueDate: { lte: new Date(`${today}T00:00:00Z`) } } }),
      this.#prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM "Member"
        WHERE "gymId" = ${gymId} AND "deletedAt" IS NULL AND "status" = 'ACTIVE'
          AND EXTRACT(MONTH FROM "dob") = ${month} AND EXTRACT(DAY FROM "dob") = ${day}
      `,
      this.#prisma.payment.aggregate({
        where: { gymId, status: 'PAID', paidAt: { gte: new Date(`${yesterday}T00:00:00+05:30`), lt: new Date(`${today}T00:00:00+05:30`) } },
        _sum: { amountPaise: true },
      }),
    ]);

    return {
      // "Ending today" is the last day of cover, not the first day without it. Those
      // members are also DUE_SOON, so the week's number leaves them out: two lines of
      // a digest that count the same person read as a mistake.
      endingToday: fees.filter((row) => row.daysLeft === 0).length,
      overdue: fees.filter((row) => row.feeState === 'EXPIRED').length,
      dueThisWeek: fees.filter((row) => row.feeState === 'DUE_SOON' && row.daysLeft !== 0).length,
      callsToday,
      birthdays: Number(birthdays[0]?.count ?? 0),
      collectedYesterdayPaise: collected._sum.amountPaise ?? 0,
    };
  }
}

type AlertRow = {
  id: string;
  type: string;
  title: string;
  params: unknown;
  createdAt: Date;
  member: { fullName: string } | null;
};

const str = (params: unknown, key: string): string | null => {
  const value = (params as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

// JSON written by different call sites may hold a number or the string of one.
const num = (params: unknown, key: string): number | null => {
  const value = (params as Record<string, unknown> | null)?.[key];
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
};

export class PrismaOwnerAlertQueue {
  readonly #prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  /**
   * Alerts the owner has not been told about yet, oldest first.
   *
   * `since` keeps a backlog from turning into a flood after the worker has been
   * down: anything older is the caller's to stamp and drop, because an alert about
   * a visit three days ago is not news.
   */
  async pending(gymId: string, since: Date, limit = 50): Promise<{ send: PendingOwnerAlert[]; drop: string[] }> {
    const rows = (await this.#prisma.alert.findMany({
      where: { gymId, notifiedAt: null },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, type: true, title: true, params: true, createdAt: true, member: { select: { fullName: true } } },
    })) as AlertRow[];

    const fresh = rows.filter((row) => row.createdAt >= since);
    const stale = rows.filter((row) => row.createdAt < since).map((row) => row.id);

    const paymentIds = fresh.map((row) => str(row.params, 'paymentId')).filter((id): id is string => id !== null);
    const leadIds = fresh.map((row) => str(row.params, 'leadId')).filter((id): id is string => id !== null);

    const [payments, leads] = await Promise.all([
      paymentIds.length === 0
        ? Promise.resolve([])
        : this.#prisma.payment.findMany({ where: { id: { in: paymentIds } }, select: { id: true, amountPaise: true, member: { select: { fullName: true } } } }),
      leadIds.length === 0 ? Promise.resolve([]) : this.#prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, name: true, goal: true, mobile: true } }),
    ]);
    const paymentById = new Map(payments.map((row) => [row.id, row]));
    const leadById = new Map(leads.map((row) => [row.id, row]));

    const send: PendingOwnerAlert[] = [];
    const drop: string[] = [...stale];

    for (const row of fresh) {
      const alert = resolve(row, paymentById, leadById);
      // An alert whose subject has since been deleted has nothing to say; stamp it
      // rather than leaving it to be retried every minute for ever.
      if (alert === null) drop.push(row.id);
      else send.push({ id: row.id, at: row.createdAt, alert });
    }

    return { send, drop };
  }

  /** How many alert messages the owner has already had inside the bundling window. */
  sentInWindow(gymId: string, since: Date): Promise<number> {
    return this.#prisma.messageLog.count({
      where: { gymId, purpose: 'OWNER_ALERT', createdAt: { gte: since }, status: { notIn: ['SKIPPED', 'FAILED'] } },
    });
  }

  async markNotified(ids: readonly string[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.#prisma.alert.updateMany({ where: { id: { in: [...ids] } }, data: { notifiedAt: at } });
  }
}

function resolve(
  row: AlertRow,
  paymentById: Map<string, { amountPaise: number; member: { fullName: string } }>,
  leadById: Map<string, { name: string; goal: string | null; mobile: string }>,
): OwnerAlert | null {
  const memberName = row.member?.fullName ?? null;

  switch (row.type) {
    case 'ONLINE_PAYMENT': {
      const payment = paymentById.get(str(row.params, 'paymentId') ?? '');
      if (payment === undefined) return null;
      return { kind: 'ONLINE_PAYMENT', memberName: memberName ?? payment.member.fullName, amountPaise: payment.amountPaise };
    }

    case 'NEW_LEAD': {
      const lead = leadById.get(str(row.params, 'leadId') ?? '');
      if (lead === undefined) return null;
      return { kind: 'NEW_LEAD', name: lead.name, goal: lead.goal, mobile: lead.mobile };
    }

    case 'MEMBER_UNSUBSCRIBED':
      return memberName === null ? null : { kind: 'MEMBER_UNSUBSCRIBED', memberName };

    case 'VERIFICATION_PENDING': {
      const referenceCode = str(row.params, 'referenceCode');
      return memberName === null || referenceCode === null ? null : { kind: 'VERIFICATION_PENDING', memberName, referenceCode };
    }

    case 'EXPIRED_MEMBER_VISIT': {
      const daysOverdue = num(row.params, 'daysOverdue');
      return memberName === null || daysOverdue === null ? null : { kind: 'EXPIRED_MEMBER_VISIT', memberName, daysOverdue };
    }

    case 'KIOSK_OFFLINE': {
      const deviceName = str(row.params, 'deviceName');
      const minutesOffline = num(row.params, 'minutesOffline');
      return deviceName === null || minutesOffline === null ? null : { kind: 'KIOSK_OFFLINE', deviceName, minutesOffline };
    }

    case 'WHATSAPP_QUALITY':
      return { kind: 'WHATSAPP_QUALITY' };

    case 'WHATSAPP_FAILURE': {
      const slot = str(row.params, 'slot');
      const failed = num(row.params, 'failed');
      const planned = num(row.params, 'planned');
      return slot === null || failed === null || planned === null ? null : { kind: 'WHATSAPP_FAILURE', slot, failed, planned };
    }

    case 'SYSTEM': {
      // The one SYSTEM alert worth a WhatsApp: money came in that does not add up.
      if (row.title !== 'crm.alerts.paymentAmountMismatch') return null;
      const payment = paymentById.get(str(row.params, 'paymentId') ?? '');
      if (payment === undefined) return null;
      return {
        kind: 'PAYMENT_AMOUNT_MISMATCH',
        memberName: memberName ?? payment.member.fullName,
        expectedPaise: payment.amountPaise,
        receivedPaise: num(row.params, 'receivedPaise') ?? 0,
      };
    }

    default:
      return null;
  }
}
