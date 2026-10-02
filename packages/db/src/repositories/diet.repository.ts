import type {
  ActivityLevel,
  DietAnswers,
  DietGoal,
  DietMemberRecord,
  DietProfileRecord,
  DietQuestionKey,
  DietStore,
  DietType,
  DietUnitOfWork,
  FollowUpStore,
  FollowUpUnitOfWork,
  OpenFollowUp,
  PlanDueFollowUp,
} from '@mfp/core';
import type { OutboxEventInput } from '@mfp/core/ports';
import { toISTDate, type E164Mobile } from '@mfp/shared';
import type { Prisma } from '../generated/prisma/client';
import { withTransaction, type PrismaClient, type TransactionClient } from '../client';
import { fromDbDate } from '../dates';

/**
 * The diet questionnaire against the database (ADR-089).
 *
 * One profile row per member, written field by field as the answers arrive. The columns
 * are nullable because that is exactly what "not asked yet" means, and the service reads
 * `undefined` for them — so the mapping in both directions is deliberate rather than a
 * spread, and a value the enum does not recognise reads as unanswered rather than crashing
 * the conversation.
 */

type Db = PrismaClient | TransactionClient;

const QUESTION_KEYS: readonly DietQuestionKey[] = [
  'weight',
  'height',
  'age',
  'goal',
  'dietType',
  'allergies',
  'mealsPerDay',
  'activityLevel',
  'workoutsPerWeek',
];

const GOALS: readonly DietGoal[] = ['MUSCLE_GAIN', 'FAT_LOSS', 'WEIGHT_GAIN', 'WEIGHT_LOSS', 'GENERAL_FITNESS', 'RECOMP'];
const TYPES: readonly DietType[] = ['VEG', 'NON_VEG', 'EGG', 'VEGAN'];
const LEVELS: readonly ActivityLevel[] = ['DESK', 'ON_FEET', 'HEAVY'];

const oneOf = <T extends string>(options: readonly T[], value: string | null): T | undefined =>
  value !== null && (options as readonly string[]).includes(value) ? (value as T) : undefined;

const orUndefined = <T>(value: T | null): T | undefined => (value === null ? undefined : value);

export function dietStore(db: Db): DietStore {
  return {
    async memberForDiet(gymId: string, memberId: string): Promise<DietMemberRecord | null> {
      const member = await db.member.findFirst({
        where: { id: memberId, gymId, deletedAt: null },
        select: {
          id: true,
          gymId: true,
          fullName: true,
          language: true,
          gender: true,
          status: true,
          whatsappOptIn: true,
          remindersUnsubscribedAt: true,
          dob: true,
        },
      });
      if (member === null) return null;
      return {
        id: member.id,
        gymId: member.gymId,
        fullName: member.fullName,
        language: member.language,
        gender: member.gender,
        status: member.status,
        whatsappOptIn: member.whatsappOptIn,
        remindersUnsubscribedAt: member.remindersUnsubscribedAt,
        dob: member.dob === null ? null : fromDbDate(member.dob),
      };
    },

    async loadProfile(gymId: string, memberId: string): Promise<DietProfileRecord | null> {
      const row = await db.dietProfile.findFirst({ where: { memberId, gymId } });
      if (row === null) return null;
      return {
        memberId: row.memberId,
        weightGrams: orUndefined(row.weightGrams),
        heightCm: orUndefined(row.heightCm),
        ageYears: orUndefined(row.ageYears),
        goal: oneOf(GOALS, row.goal),
        dietType: oneOf(TYPES, row.dietType),
        allergies: orUndefined(row.allergies),
        mealsPerDay: orUndefined(row.mealsPerDay),
        activityLevel: oneOf(LEVELS, row.activityLevel),
        workoutsPerWeek: orUndefined(row.workoutsPerWeek),
        pendingQuestion: oneOf(QUESTION_KEYS, row.pendingQuestion) ?? null,
        nudgesSent: row.nudgesSent,
        completedAt: row.completedAt,
      };
    },

    async saveProfile(gymId: string, memberId: string, patch: Partial<DietProfileRecord>): Promise<void> {
      // `undefined` means "this patch does not mention it"; the column keeps what it had.
      // Only `pendingQuestion` and `completedAt` are ever deliberately cleared, and the
      // service passes `null` for those, which Prisma writes as NULL.
      const data = {
        ...(patch.weightGrams === undefined ? {} : { weightGrams: patch.weightGrams }),
        ...(patch.heightCm === undefined ? {} : { heightCm: patch.heightCm }),
        ...(patch.ageYears === undefined ? {} : { ageYears: patch.ageYears }),
        ...(patch.goal === undefined ? {} : { goal: patch.goal }),
        ...(patch.dietType === undefined ? {} : { dietType: patch.dietType }),
        ...(patch.allergies === undefined ? {} : { allergies: patch.allergies }),
        ...(patch.mealsPerDay === undefined ? {} : { mealsPerDay: patch.mealsPerDay }),
        ...(patch.activityLevel === undefined ? {} : { activityLevel: patch.activityLevel }),
        ...(patch.workoutsPerWeek === undefined ? {} : { workoutsPerWeek: patch.workoutsPerWeek }),
        ...('pendingQuestion' in patch ? { pendingQuestion: patch.pendingQuestion } : {}),
        ...(patch.nudgesSent === undefined ? {} : { nudgesSent: patch.nudgesSent }),
        ...('completedAt' in patch ? { completedAt: patch.completedAt } : {}),
        ...('askedAt' in patch ? { askedAt: (patch as { askedAt?: Date }).askedAt } : {}),
        ...('lastReplyAt' in patch ? { lastReplyAt: (patch as { lastReplyAt?: Date }).lastReplyAt } : {}),
      };

      await db.dietProfile.upsert({
        where: { memberId },
        create: { gymId, memberId, ...data },
        update: data,
      });
    },

    async enqueueOutbox(event: OutboxEventInput): Promise<void> {
      await db.outboxEvent.createMany({
        data: [
          {
            gymId: event.gymId,
            type: event.type,
            payload: event.payload as Prisma.InputJsonValue,
            dedupeKey: event.dedupeKey,
            ...(event.availableAt === undefined ? {} : { availableAt: event.availableAt }),
          },
        ],
        skipDuplicates: true,
      });
    },
  };
}

/**
 * The monthly check against the database (ADR-089).
 *
 * `plansDueFollowUp` returns every current plan rather than only the due ones: deciding what
 * is due is `followUpDue`'s job, which knows about the owner's setting and can be tested
 * without a database. The query stays one indexed read either way.
 */
export function followUpStore(db: Db): FollowUpStore {
  return {
    async plansDueFollowUp(gymId?: string): Promise<readonly PlanDueFollowUp[]> {
      const rows = await db.dietPlan.findMany({
        where: { status: 'READY', ...(gymId === undefined ? {} : { gymId }) },
        select: {
          id: true,
          gymId: true,
          memberId: true,
          generatedAt: true,
          answers: true,
          member: { select: { status: true, whatsappOptIn: true, remindersUnsubscribedAt: true } },
          followUps: { orderBy: { askedAt: 'desc' }, take: 1, select: { askedAt: true } },
        },
      });

      return rows.flatMap((row): PlanDueFollowUp[] => {
        if (row.generatedAt === null) return [];
        const answers = (row.answers ?? {}) as { weightGrams?: number };
        return [
          {
            planId: row.id,
            gymId: row.gymId,
            memberId: row.memberId,
            // Both are timestamps, not DATE columns: `toISTDate` is what turns an instant
            // into the IST day it fell on. `fromDbDate` would be a day out near midnight.
            generatedAt: toISTDate(row.generatedAt),
            lastFollowUpOn: row.followUps[0] === undefined ? null : toISTDate(row.followUps[0].askedAt),
            weightAtPlanGrams: answers.weightGrams,
            whatsappOptIn: row.member.whatsappOptIn,
            remindersUnsubscribedAt: row.member.remindersUnsubscribedAt,
            memberStatus: row.member.status,
          },
        ];
      });
    },

    async openFollowUpFor(gymId: string, memberId: string): Promise<OpenFollowUp | null> {
      const row = await db.dietFollowUp.findFirst({
        where: { gymId, memberId, completedAt: null },
        orderBy: { askedAt: 'desc' },
        select: { id: true, dietPlanId: true, memberId: true, answers: true, pendingQuestion: true, completedAt: true },
      });
      if (row === null) return null;
      return {
        id: row.id,
        planId: row.dietPlanId,
        memberId: row.memberId,
        answers: (row.answers ?? {}) as Record<string, unknown>,
        pendingQuestion: row.pendingQuestion,
        completedAt: row.completedAt,
      };
    },

    async createFollowUp(input): Promise<string> {
      const created = await db.dietFollowUp.create({
        data: { gymId: input.gymId, memberId: input.memberId, dietPlanId: input.planId, pendingQuestion: input.pendingQuestion, answers: {} },
        select: { id: true },
      });
      return created.id;
    },

    async saveFollowUp(id, patch): Promise<void> {
      await db.dietFollowUp.update({
        where: { id },
        data: {
          ...(patch.answers === undefined ? {} : { answers: patch.answers as Prisma.InputJsonValue }),
          ...('pendingQuestion' in patch ? { pendingQuestion: patch.pendingQuestion } : {}),
          ...('completedAt' in patch ? { completedAt: patch.completedAt } : {}),
        },
      });
    },

    async savedWeight(memberId: string, weightGrams: number): Promise<void> {
      await db.dietProfile.update({ where: { memberId }, data: { weightGrams } });
    },

    async enqueueOutbox(event: OutboxEventInput): Promise<void> {
      await db.outboxEvent.createMany({
        data: [
          {
            gymId: event.gymId,
            type: event.type,
            payload: event.payload as Prisma.InputJsonValue,
            dedupeKey: event.dedupeKey,
            ...(event.availableAt === undefined ? {} : { availableAt: event.availableAt }),
          },
        ],
        skipDuplicates: true,
      });
    },
  };
}

export class PrismaDietFollowUps implements FollowUpUnitOfWork {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  transaction<T>(work: (store: FollowUpStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(followUpStore(tx)));
  }

  /** Which follow-up question a number is being asked, for routing a reply. */
  async pendingAtMobile(gymId: string, mobile: string): Promise<{ readonly memberId: string; readonly question: string } | null> {
    const row = await this.#prisma.dietFollowUp.findFirst({
      where: { gymId, completedAt: null, pendingQuestion: { not: null }, member: { mobile, deletedAt: null } },
      orderBy: { askedAt: 'asc' },
      select: { memberId: true, pendingQuestion: true },
    });
    return row === null || row.pendingQuestion === null ? null : { memberId: row.memberId, question: row.pendingQuestion };
  }
}

export class PrismaDietUnitOfWork implements DietUnitOfWork {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  transaction<T>(work: (store: DietStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(dietStore(tx)));
  }
}

/** The member a WhatsApp reply came from, for routing it (ADR-089). */
export class PrismaDietInbox {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  /**
   * Who is waiting on a question at this number.
   *
   * Numbers are shared by families (SU-08), so the reply goes to whoever we actually asked
   * something. If that is somehow more than one person, the oldest question wins — it is
   * the one that has been waiting.
   */
  async pendingAtMobile(gymId: string, mobile: E164Mobile): Promise<{ readonly memberId: string; readonly question: string } | null> {
    const row = await this.#prisma.dietProfile.findFirst({
      where: { gymId, pendingQuestion: { not: null }, member: { mobile, deletedAt: null } },
      orderBy: { askedAt: 'asc' },
      select: { memberId: true, pendingQuestion: true },
    });
    return row === null || row.pendingQuestion === null ? null : { memberId: row.memberId, question: row.pendingQuestion };
  }
}

/**
 * Writing plans (ADR-089).
 *
 * A plan is created `GENERATING` before the model is called, so a half-finished batch is
 * visible in the CRM rather than invisible, and the version is taken under the same write —
 * two generations started at once cannot both claim version 3, because the unique index on
 * `(memberId, version)` refuses the second and the job retries.
 */
export class PrismaDietPlans {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async start(input: {
    readonly gymId: string;
    readonly memberId: string;
    readonly answers: DietAnswers;
    readonly bmiTenths: number | null;
    readonly requestedById: string | null;
  }): Promise<{ readonly id: string; readonly version: number }> {
    return await withTransaction(this.#prisma, async (tx) => {
      const latest = await tx.dietPlan.findFirst({ where: { memberId: input.memberId }, orderBy: { version: 'desc' }, select: { version: true } });
      const version = (latest?.version ?? 0) + 1;
      // Everything older is history the member no longer follows.
      await tx.dietPlan.updateMany({ where: { memberId: input.memberId, status: 'READY' }, data: { status: 'SUPERSEDED' } });
      const created = await tx.dietPlan.create({
        data: {
          gymId: input.gymId,
          memberId: input.memberId,
          version,
          status: 'GENERATING',
          answers: input.answers as Prisma.InputJsonValue,
          bmiTenths: input.bmiTenths,
          requestedById: input.requestedById,
        },
        select: { id: true, version: true },
      });
      return created;
    });
  }

  async markReady(planId: string, input: { readonly doc: unknown; readonly model: string; readonly at: Date }): Promise<void> {
    await this.#prisma.dietPlan.update({
      where: { id: planId },
      data: { status: 'READY', doc: input.doc as Prisma.InputJsonValue, model: input.model, generatedAt: input.at, failureReason: null },
    });
  }

  async markFailed(planId: string, reason: string): Promise<void> {
    // The reason is a code, never the model's own words: those could carry anything.
    await this.#prisma.dietPlan.update({ where: { id: planId }, data: { status: 'FAILED', failureReason: reason.slice(0, 60) } });
  }

  async markSent(planId: string, at: Date): Promise<void> {
    await this.#prisma.dietPlan.update({ where: { id: planId }, data: { sentAt: at } });
  }

  /** The newest plan for a member, whatever state it is in. */
  async latest(gymId: string, memberId: string) {
    return await this.#prisma.dietPlan.findFirst({
      where: { gymId, memberId },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, status: true, doc: true, bmiTenths: true, answers: true, sentAt: true, generatedAt: true },
    });
  }
}

/** What the CRM's diet screens read. */
export interface DietPlanListItem {
  readonly memberId: string;
  readonly fullName: string;
  readonly memberCode: string | null;
  readonly status: string;
  readonly version: number | null;
  readonly planStatus: string | null;
  readonly goal: string | null;
  readonly dietType: string | null;
  readonly bmiTenths: number | null;
  readonly generatedAt: Date | null;
  readonly sentAt: Date | null;
  /** The question they are being asked right now, when they are mid-questionnaire. */
  readonly pendingQuestion: string | null;
}

export class PrismaDietReader {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  /** Everyone with a diet plan or a questionnaire under way, newest activity first. */
  async overview(gymId: string, limit = 100): Promise<DietPlanListItem[]> {
    const [plans, asking] = await Promise.all([
      this.#prisma.dietPlan.findMany({
        where: { gymId },
        orderBy: [{ memberId: 'asc' }, { version: 'desc' }],
        select: {
          memberId: true,
          version: true,
          status: true,
          bmiTenths: true,
          generatedAt: true,
          sentAt: true,
          answers: true,
          member: { select: { fullName: true, memberCode: true, status: true } },
        },
      }),
      this.#prisma.dietProfile.findMany({
        where: { gymId, pendingQuestion: { not: null } },
        select: { memberId: true, pendingQuestion: true, goal: true, dietType: true, member: { select: { fullName: true, memberCode: true, status: true } } },
      }),
    ]);

    const rows = new Map<string, DietPlanListItem>();
    // The newest version of each member's plan; the query already orders them.
    for (const plan of plans) {
      if (rows.has(plan.memberId)) continue;
      const answers = (plan.answers ?? {}) as { goal?: string; dietType?: string };
      rows.set(plan.memberId, {
        memberId: plan.memberId,
        fullName: plan.member.fullName,
        memberCode: plan.member.memberCode,
        status: plan.member.status,
        version: plan.version,
        planStatus: plan.status,
        goal: answers.goal ?? null,
        dietType: answers.dietType ?? null,
        bmiTenths: plan.bmiTenths,
        generatedAt: plan.generatedAt,
        sentAt: plan.sentAt,
        pendingQuestion: null,
      });
    }
    for (const profile of asking) {
      const existing = rows.get(profile.memberId);
      rows.set(profile.memberId, {
        memberId: profile.memberId,
        fullName: profile.member.fullName,
        memberCode: profile.member.memberCode,
        status: profile.member.status,
        version: existing?.version ?? null,
        planStatus: existing?.planStatus ?? null,
        goal: profile.goal,
        dietType: profile.dietType,
        bmiTenths: existing?.bmiTenths ?? null,
        generatedAt: existing?.generatedAt ?? null,
        sentAt: existing?.sentAt ?? null,
        pendingQuestion: profile.pendingQuestion,
      });
    }

    return [...rows.values()]
      .sort((a, b) => {
        // Waiting on a member comes first: that is where somebody might need to step in.
        if ((a.pendingQuestion === null) !== (b.pendingQuestion === null)) return a.pendingQuestion === null ? 1 : -1;
        return (b.generatedAt?.getTime() ?? 0) - (a.generatedAt?.getTime() ?? 0) || a.fullName.localeCompare(b.fullName);
      })
      .slice(0, limit);
  }

  /** Every plan a member has had, newest first, for their profile page. */
  async plansFor(gymId: string, memberId: string, limit = 10) {
    return await this.#prisma.dietPlan.findMany({
      where: { gymId, memberId },
      orderBy: { version: 'desc' },
      take: limit,
      select: { id: true, version: true, status: true, bmiTenths: true, doc: true, answers: true, failureReason: true, generatedAt: true, sentAt: true, pdfMediaId: true },
    });
  }

  /** What the generator needs: the answers, and who they belong to. */
  async forGeneration(gymId: string, memberId: string) {
    const [member, profile] = await Promise.all([
      this.#prisma.member.findFirst({
        where: { id: memberId, gymId, deletedAt: null },
        select: { id: true, fullName: true, language: true, gender: true, mobile: true, memberCode: true },
      }),
      this.#prisma.dietProfile.findFirst({ where: { gymId, memberId } }),
    ]);
    if (member === null || profile === null) return null;

    const answers: DietAnswers = {
      weightGrams: orUndefined(profile.weightGrams),
      heightCm: orUndefined(profile.heightCm),
      ageYears: orUndefined(profile.ageYears),
      goal: oneOf(GOALS, profile.goal),
      dietType: oneOf(TYPES, profile.dietType),
      allergies: orUndefined(profile.allergies),
      mealsPerDay: orUndefined(profile.mealsPerDay),
      activityLevel: oneOf(LEVELS, profile.activityLevel),
      workoutsPerWeek: orUndefined(profile.workoutsPerWeek),
    };
    return {
      member: {
        id: member.id,
        firstName: member.fullName.trim().split(/\s+/)[0] ?? member.fullName,
        language: member.language,
        gender: member.gender,
        mobile: member.mobile as E164Mobile,
      },
      answers,
    };
  }
}
