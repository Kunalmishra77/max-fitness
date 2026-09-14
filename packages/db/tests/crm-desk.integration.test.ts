/**
 * The CRM fee desk against a real database (testing-strategy.md §5, case P9).
 *
 * P1–P8 cover online payment in payments.integration.test.ts; P9 is the desk's
 * correction — the owner voids a payment entered wrongly. The unit tests prove the
 * rules with in-memory stores; this proves what only PostgreSQL can: that the row lock
 * lets exactly one of two simultaneous voids through, that the receipt number survives
 * the void so the series stays gapless (BR-11.2), and that the membership goes back to
 * unpaid with an audit row naming who did it.
 *
 * Recording a call outcome (BR-7) is here too, because it is the other CRM action that
 * changes rows rather than creating them, and its date columns are DATE in IST.
 *
 * Everything is written under a throwaway gym and deleted afterwards.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { RegistrationFieldsSchema, addDays, todayIST, type Clock } from '@mfp/shared';
import {
  addStaff,
  advanceLead,
  changeOwnPin,
  sessionTokenHash,
  DomainError,
  elevationExpiry,
  markAttendance,
  monthBounds,
  recordCallOutcome,
  updateGymSettings,
  updatePlanPrices,
  recordDeskPayment,
  registerAtDesk,
  registerMember,
  resetStaffPin,
  setStaffActive,
  undoAttendance,
  voidPayment,
  type CheckoutSettings,
  type CrmActor,
  type PutObjectRequest,
  type StorageDriver,
  type StoredObject,
} from '@mfp/core';
import { fakeClockAt } from '@mfp/core/testing';
import { createPrismaClient, type PrismaClient } from '../src/client';
import { fromDbDate, toDbDate } from '../src/dates';
import { PrismaAttendanceUnitOfWork } from '../src/repositories/attendance.repository';
import { PrismaLeadPipelineUnitOfWork } from '../src/repositories/lead-pipeline.repository';
import { PrismaReportsReader } from '../src/repositories/reports-read.repository';
import { PrismaSettingsUnitOfWork } from '../src/repositories/settings.repository';
import { PrismaOwnPinUnitOfWork, PrismaStaffUnitOfWork } from '../src/repositories/staff.repository';
import { PrismaCallOutcomeUnitOfWork, PrismaVoidPaymentUnitOfWork } from '../src/repositories/crm-actions.repository';
import { PrismaCrmReader } from '../src/repositories/crm-read.repository';
import { PrismaDeskPaymentUnitOfWork } from '../src/repositories/desk-payment.repository';
import { PrismaRegistrationUnitOfWork } from '../src/repositories/registration.repository';
import { integrationSuite, testDatabaseUrl } from './support';

const run = randomBytes(5).toString('hex');
const gymId = `gym_it_crm_${run}`;
const ownerId = `staff_it_owner_${run}`;
let sequence = 0;
const unique = (label: string) => `${label}_it_${run}_${++sequence}`;

const settings: CheckoutSettings = {
  pricing: { admissionFeePaise: 0, otherGenderPricing: 'ASK_AT_DESK', allowDeskDiscounts: true },
  maxStartDateDaysAhead: 15,
  renewalGraceDays: 5,
};

const MONTH_PLAN_ID = `${gymId}_M1_MALE`;
const MONTH_PRICE = 150_000;

class MemoryStorage implements StorageDriver {
  readonly name = 'local' as const;
  readonly objects = new Map<string, Uint8Array>();
  put(request: PutObjectRequest): Promise<StoredObject> {
    const key = `${request.prefix}/${unique('object')}`;
    this.objects.set(key, request.body);
    return Promise.resolve({ key, sizeBytes: request.body.byteLength, sha256: 'a'.repeat(64), mimeType: request.mimeType });
  }
  get(key: string): Promise<Uint8Array> {
    const body = this.objects.get(key);
    return body === undefined ? Promise.reject(new Error('missing')) : Promise.resolve(body);
  }
  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
  exists(key: string): Promise<boolean> {
    return Promise.resolve(this.objects.has(key));
  }
  signedUrl(key: string): Promise<string> {
    return Promise.resolve(`memory:${key}`);
  }
}

const suite = integrationSuite('CRM fee desk (P9)');

suite('CRM fee desk against Postgres', () => {
  let prisma: PrismaClient;
  let deskUow: PrismaDeskPaymentUnitOfWork;
  let voidUow: PrismaVoidPaymentUnitOfWork;
  let callUow: PrismaCallOutcomeUnitOfWork;

  beforeAll(async () => {
    prisma = createPrismaClient({ connectionString: testDatabaseUrl, poolMax: 4 });
    deskUow = new PrismaDeskPaymentUnitOfWork(prisma);
    voidUow = new PrismaVoidPaymentUnitOfWork(prisma);
    callUow = new PrismaCallOutcomeUnitOfWork(prisma);

    await prisma.gym.create({
      data: {
        id: gymId,
        slug: gymId,
        name: 'CRM integration gym',
        phone: '+919000000008',
        addressLine: 'Test',
        city: 'Test',
        state: 'Test',
        pincode: '000000',
        settings: {},
      },
    });
    await prisma.plan.create({
      data: { id: MONTH_PLAN_ID, gymId, code: 'M1_MALE', durationMonths: 1, gender: 'MALE', pricePaise: MONTH_PRICE },
    });
    await prisma.staffUser.create({
      data: { id: ownerId, gymId, name: 'Integration Owner', mobile: `+9190000${run.slice(0, 5)}`, role: 'OWNER', pinHash: 'not-used-here' },
    });
  });

  afterAll(async () => {
    if (prisma === undefined) return;
    await prisma.auditLog.deleteMany({ where: { gymId } });
    await prisma.outboxEvent.deleteMany({ where: { gymId } });
    await prisma.alert.deleteMany({ where: { gymId } });
    await prisma.consent.deleteMany({ where: { gymId } });
    await prisma.attendanceEvent.deleteMany({ where: { gymId } });
    await prisma.lead.deleteMany({ where: { gymId } });
    await prisma.callTask.deleteMany({ where: { gymId } });
    await prisma.payment.deleteMany({ where: { gymId } });
    await prisma.membership.deleteMany({ where: { gymId } });
    await prisma.member.updateMany({ where: { gymId }, data: { photoMediaId: null } });
    await prisma.mediaFile.deleteMany({ where: { gymId } });
    await prisma.member.deleteMany({ where: { gymId } });
    await prisma.session.deleteMany({ where: { staffUser: { gymId } } });
    await prisma.staffUser.deleteMany({ where: { gymId } });
    await prisma.counter.deleteMany({ where: { gymId } });
    await prisma.plan.deleteMany({ where: { gymId } });
    await prisma.gym.deleteMany({ where: { id: gymId } });
    await prisma.$disconnect();
  });

  // ── helpers ────────────────────────────────────────────────────────────────

  /** The owner with a PIN entered a moment ago, which is what voiding needs. */
  const ownerActor = (clock: Clock): CrmActor => ({
    staffUserId: ownerId,
    gymId,
    role: 'OWNER',
    elevatedUntil: elevationExpiry(clock.now()),
    receptionMayTakePayments: true,
  });

  const register = (clock: Clock, fullName = 'Desk Member') =>
    registerMember(
      RegistrationFieldsSchema.parse({
        fullName,
        mobile: '9000020002',
        dob: '1995-05-05',
        gender: 'MALE',
        language: 'hi',
        consents: { terms: true, privacy: true, whatsappUpdates: true, faceAttendance: false },
        noticeVersion: '1.0',
      }),
      { body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 480, height: 640 },
      {
        clock,
        uow: new PrismaRegistrationUnitOfWork(prisma),
        storage: new MemoryStorage(),
        tokenSecret: 'integration-test-secret-of-32-plus-chars',
        gymId,
        minAge: 16,
        // The desk's own add-member wizard is still to come; until then a desk member is
        // registered through the same path the website uses.
        channel: 'web_signup',
        source: 'WEBSITE',
        ipHash: null,
        userAgent: 'vitest',
      },
    );

  /** A member who has paid at the desk: the starting point for every void. */
  const paidAtDesk = async (clock: Clock, fullName?: string) => {
    const { memberId } = await register(clock, fullName);
    const payment = await recordDeskPayment(
      { memberId, planId: MONTH_PLAN_ID, method: 'CASH' },
      { actor: ownerActor(clock), clock, uow: deskUow, settings },
    );
    return { memberId, ...payment };
  };

  // ── tests ──────────────────────────────────────────────────────────────────

  it('takes a payment at the desk, confirming the membership and activating the member', async () => {
    const clock = fakeClockAt('2026-09-12T11:30');
    const { memberId, paymentId, membershipId, receiptNo, memberCode } = await paidAtDesk(clock, 'Desk Paid');

    expect(receiptNo).toMatch(/^MF\/\d{4}-\d{2}\/\d{6}$/);
    expect(memberCode).toMatch(/^MF-\d{4}$/);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment).toMatchObject({ status: 'PAID', method: 'CASH', amountPaise: MONTH_PRICE, recordedById: ownerId, receiptNo });
    expect(await prisma.member.findUniqueOrThrow({ where: { id: memberId }, select: { status: true } })).toEqual({ status: 'ACTIVE' });
    expect(await prisma.membership.findUniqueOrThrow({ where: { id: membershipId }, select: { status: true } })).toEqual({ status: 'CONFIRMED' });
  });

  it('adds a walk-in member at the desk, with the staff member on the member and on every consent', async () => {
    const clock = fakeClockAt('2026-09-12T11:30');

    const { memberId, possibleDuplicate } = await registerAtDesk(
      {
        fields: RegistrationFieldsSchema.parse({
          fullName: 'वॉक इन मेंबर',
          mobile: '9000030003',
          dob: '1994-03-03',
          gender: 'FEMALE',
          language: 'hi',
          consents: { terms: true, privacy: true, whatsappUpdates: true, faceAttendance: false },
          noticeVersion: '1.0',
        }),
      },
      { actor: ownerActor(clock), clock, uow: new PrismaRegistrationUnitOfWork(prisma), storage: new MemoryStorage(), minAge: 16 },
    );

    expect(possibleDuplicate).toBe(false);
    const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId }, include: { consents: true } });
    expect(member).toMatchObject({ status: 'PENDING_PAYMENT', source: 'WALK_IN', createdById: ownerId, whatsappOptIn: true, faceConsent: false });
    // No camera at this desk, and that must not stop anyone joining.
    expect(member.photoMediaId).toBeNull();
    expect(member.consents).toHaveLength(4);
    expect(member.consents.every((row) => row.channel === 'crm_desk' && row.recordedById === ownerId)).toBe(true);
  });

  it('P9: voiding a desk payment keeps the receipt number, unpays the membership and leaves an audit trail', async () => {
    const clock = fakeClockAt('2026-09-12T11:30');
    const { paymentId, membershipId, receiptNo } = await paidAtDesk(clock, 'Desk Void');

    const result = await voidPayment({ paymentId, reason: 'गलत रकम डाल दी' }, { actor: ownerActor(clock), clock, uow: voidUow });
    expect(result).toMatchObject({ paymentId, membershipId, amountPaise: MONTH_PRICE });

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment).toMatchObject({ status: 'VOIDED', voidedById: ownerId, voidReason: 'गलत रकम डाल दी' });
    // The receipt was handed over; its number stays on the row and is never reissued (BR-11.2).
    expect(payment.receiptNo).toBe(receiptNo);

    const membership = await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } });
    expect(membership).toMatchObject({ status: 'PENDING_PAYMENT', confirmedAt: null });
    expect(membership.cancelledAt).not.toBeNull();

    const audit = await prisma.auditLog.findMany({ where: { gymId, entityId: paymentId } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'payment.void', actorType: 'staff', actorId: ownerId, entityType: 'Payment' });
    expect(audit[0]?.before).toMatchObject({ status: 'PAID', amountPaise: MONTH_PRICE, receiptNo });
  });

  it('P9: two owners tapping void at the same moment void it once', async () => {
    const clock = fakeClockAt('2026-09-12T11:30');
    const { paymentId, membershipId } = await paidAtDesk(clock, 'Desk Double Void');

    const attempts = await Promise.allSettled([
      voidPayment({ paymentId, reason: 'दो बार टैप' }, { actor: ownerActor(clock), clock, uow: voidUow }),
      voidPayment({ paymentId, reason: 'दो बार टैप' }, { actor: ownerActor(clock), clock, uow: voidUow }),
    ]);

    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find((a) => a.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(DomainError);
    expect(rejected?.reason).toMatchObject({ code: 'PAYMENT_ALREADY_SETTLED' });

    expect(await prisma.auditLog.count({ where: { gymId, entityId: paymentId } })).toBe(1);
    expect(await prisma.membership.findUniqueOrThrow({ where: { id: membershipId }, select: { status: true } })).toEqual({
      status: 'PENDING_PAYMENT',
    });
  });

  it('P9: the same payment cannot be voided twice, and a voided receipt number is never reused', async () => {
    const clock = fakeClockAt('2026-09-12T11:30');
    const first = await paidAtDesk(clock, 'Desk Series A');
    await voidPayment({ paymentId: first.paymentId, reason: 'रद्द' }, { actor: ownerActor(clock), clock, uow: voidUow });

    await expect(
      voidPayment({ paymentId: first.paymentId, reason: 'फिर से' }, { actor: ownerActor(clock), clock, uow: voidUow }),
    ).rejects.toMatchObject({ code: 'PAYMENT_ALREADY_SETTLED' });

    // The next payment takes the next number: the series moves on, it does not fill the gap.
    const second = await paidAtDesk(clock, 'Desk Series B');
    expect(second.receiptNo).not.toBe(first.receiptNo);
    expect(Number(second.receiptNo.slice(-6))).toBe(Number(first.receiptNo.slice(-6)) + 1);
  });

  it('keeps a snoozed call out of today’s list until the day it comes back', async () => {
    const clock = fakeClockAt('2026-09-12T11:30');
    const today = todayIST(clock);
    // A partial unique index allows one OPEN task per member and reason (BR-7 dedupe),
    // so the three cases need three members.
    const dueMember = await paidAtDesk(clock, 'Desk Snooze A');
    const snoozedMember = await paidAtDesk(clock, 'Desk Snooze B');
    const backMember = await paidAtDesk(clock, 'Desk Snooze C');

    const base = { gymId, reason: 'EXPIRED_NOT_RENEWED', priority: 1, dueDate: toDbDate(today), status: 'OPEN' } as const;
    const dueToday = await prisma.callTask.create({ data: { ...base, memberId: dueMember.memberId } });
    const snoozed = await prisma.callTask.create({
      data: { ...base, memberId: snoozedMember.memberId, snoozedUntil: toDbDate(addDays(today, 1)) },
    });
    const backToday = await prisma.callTask.create({ data: { ...base, memberId: backMember.memberId, snoozedUntil: toDbDate(today) } });

    const ids = (await new PrismaCrmReader(prisma).callTasks(gymId, today, 100)).map((task) => task.id);

    expect(ids).toContain(dueToday.id);
    // Snoozing is the whole point of "call later": it must actually leave today's list.
    expect(ids).not.toContain(snoozed.id);
    expect(ids).toContain(backToday.id);
  });

  it('marks attendance by hand, moves the member’s last visit, and takes it back on undo', async () => {
    const clock = fakeClockAt('2026-09-12T11:30');
    const today = todayIST(clock);
    const { memberId } = await paidAtDesk(clock, 'Desk Attendance');
    const actor = ownerActor(clock);
    const attendanceUow = new PrismaAttendanceUnitOfWork(prisma);
    const reader = new PrismaCrmReader(prisma);

    const marked = await markAttendance(
      { memberId, clientEventId: unique('tap'), feeStateAtCheckIn: 'PAID' },
      { actor, clock, uow: attendanceUow, cooldownMinutes: 180 },
    );
    expect(marked).toMatchObject({ decision: 'RECORD' });

    const event = await prisma.attendanceEvent.findUniqueOrThrow({ where: { id: marked.eventId! } });
    expect(event).toMatchObject({ method: 'MANUAL', recordedById: ownerId, feeStateAtCheckIn: 'PAID', voidedAt: null });
    expect(fromDbDate(event.attendanceDate)).toBe(today);
    // The cooldown and the "not coming" list are both read from this column.
    expect((await prisma.member.findUniqueOrThrow({ where: { id: memberId } })).lastAttendanceAt).toEqual(clock.now());
    expect((await reader.attendanceToday(gymId, today)).map((row) => row.id)).toContain(marked.eventId);

    // Walking past again inside the cooldown is the same visit (BR-9.1).
    const again = await markAttendance({ memberId, clientEventId: unique('tap') }, { actor, clock, uow: attendanceUow, cooldownMinutes: 180 });
    expect(again).toEqual({ decision: 'WITHIN_COOLDOWN', eventId: null, callTaskRaised: false });
    expect(await prisma.attendanceEvent.count({ where: { memberId, voidedAt: null } })).toBe(1);

    await undoAttendance({ eventId: marked.eventId! }, { actor, clock, uow: attendanceUow });

    expect((await prisma.attendanceEvent.findUniqueOrThrow({ where: { id: marked.eventId! } })).voidedAt).not.toBeNull();
    expect((await prisma.member.findUniqueOrThrow({ where: { id: memberId } })).lastAttendanceAt).toBeNull();
    expect((await reader.attendanceToday(gymId, today)).map((row) => row.id)).not.toContain(marked.eventId);
  });

  it('treats the same tap arriving twice as one visit', async () => {
    const clock = fakeClockAt('2026-09-12T11:30');
    const { memberId } = await paidAtDesk(clock, 'Desk Double Tap');
    const deps = { actor: ownerActor(clock), clock, uow: new PrismaAttendanceUnitOfWork(prisma), cooldownMinutes: 180 };
    const clientEventId = unique('tap');

    expect(await markAttendance({ memberId, clientEventId }, deps)).toMatchObject({ decision: 'RECORD' });
    expect(await markAttendance({ memberId, clientEventId }, deps)).toEqual({ decision: 'DUPLICATE_EVENT', eventId: null, callTaskRaised: false });
    expect(await prisma.attendanceEvent.count({ where: { memberId } })).toBe(1);
  });

  it('moves an enquiry along, keeping every note, and refuses to go backwards (BR-10.1)', async () => {
    const clock = fakeClockAt('2026-09-12T11:30');
    const actor = ownerActor(clock);
    const uow = new PrismaLeadPipelineUnitOfWork(prisma);
    const lead = await prisma.lead.create({
      data: { gymId, name: 'पूछताछ टेस्ट', mobile: '+919000040004', goal: 'WEIGHT_LOSS', source: 'WEBSITE_HERO', status: 'NEW' },
    });

    await advanceLead({ leadId: lead.id, to: 'CONTACTED', note: 'फोन किया' }, { actor, clock, uow });
    await advanceLead({ leadId: lead.id, to: 'VISITED', note: 'आकर देख गए' }, { actor, clock, uow });

    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.status).toBe('VISITED');
    expect(after.notes).toBe('2026-09-12: फोन किया\n2026-09-12: आकर देख गए');

    await expect(advanceLead({ leadId: lead.id, to: 'CONTACTED' }, { actor, clock, uow })).rejects.toMatchObject({ code: 'CONFLICT' });

    await advanceLead({ leadId: lead.id, to: 'CONVERTED' }, { actor, clock, uow });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe('CONVERTED');
    // A closed enquiry stays closed.
    await expect(advanceLead({ leadId: lead.id, to: 'LOST' }, { actor, clock, uow })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('puts an expired member who walks in on the call list once, however often they come (BR-7, BR-9.3)', async () => {
    const clock = fakeClockAt('2026-09-12T11:30');
    const { memberId } = await paidAtDesk(clock, 'Desk Expired Visitor');
    const uow = new PrismaAttendanceUnitOfWork(prisma);
    const actor = ownerActor(clock);

    const first = await markAttendance({ memberId, clientEventId: unique('tap'), feeStateAtCheckIn: 'EXPIRED' }, { actor, clock, uow, cooldownMinutes: 180 });
    expect(first).toMatchObject({ decision: 'RECORD', callTaskRaised: true });

    // A second recorded visit (no cooldown here) must not stack a second open task.
    const second = await markAttendance({ memberId, clientEventId: unique('tap'), feeStateAtCheckIn: 'EXPIRED' }, { actor, clock, uow, cooldownMinutes: 0 });
    expect(second).toMatchObject({ decision: 'RECORD', callTaskRaised: false });

    const tasks = await prisma.callTask.findMany({ where: { memberId, reason: 'EXPIRED_BUT_VISITING' } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: 'OPEN', priority: 1 });
    expect(fromDbDate(tasks[0]!.dueDate)).toBe(todayIST(clock));
  });

  it('closes an enquiry’s open "new lead" call when the enquiry moves on (BR-7 auto-close)', async () => {
    const clock = fakeClockAt('2026-09-12T11:30');
    const lead = await prisma.lead.create({
      data: { gymId, name: 'बिना कॉल की पूछताछ', mobile: '+919000060006', source: 'WEBSITE_HERO', status: 'NEW' },
    });
    const task = await prisma.callTask.create({
      data: { gymId, leadId: lead.id, reason: 'NEW_LEAD', priority: 2, dueDate: toDbDate(todayIST(clock)), status: 'OPEN' },
    });

    await advanceLead({ leadId: lead.id, to: 'CONTACTED' }, { actor: ownerActor(clock), clock, uow: new PrismaLeadPipelineUnitOfWork(prisma) });

    expect(await prisma.callTask.findUniqueOrThrow({ where: { id: task.id }, select: { status: true, doneById: true } })).toEqual({
      status: 'DONE',
      doneById: ownerId,
    });
  });

  it('turns recent enquiries from the same number into the member who registers, and leaves an old one alone (BR-10.2)', async () => {
    const clock = fakeClockAt('2026-09-12T11:30');
    const mobile = '+919000050005';
    const recentNew = await prisma.lead.create({ data: { gymId, name: 'नई पूछताछ', mobile, source: 'WEBSITE_HERO', status: 'NEW' } });
    const recentLost = await prisma.lead.create({ data: { gymId, name: 'छोड़ी पूछताछ', mobile, source: 'PHONE', status: 'LOST' } });
    const tooOld = await prisma.lead.create({
      data: { gymId, name: 'पुरानी पूछताछ', mobile, source: 'PHONE', status: 'NEW', createdAt: new Date(clock.now().getTime() - 61 * 86_400_000) },
    });
    const task = await prisma.callTask.create({
      data: { gymId, leadId: recentNew.id, reason: 'NEW_LEAD', priority: 2, dueDate: toDbDate(todayIST(clock)), status: 'OPEN' },
    });

    const { memberId } = await registerAtDesk(
      {
        fields: RegistrationFieldsSchema.parse({
          fullName: 'पूछताछ से मेंबर',
          mobile: '9000050005',
          dob: '1993-02-02',
          gender: 'MALE',
          language: 'hi',
          consents: { terms: true, privacy: true, whatsappUpdates: true, faceAttendance: false },
          noticeVersion: '1.0',
        }),
      },
      { actor: ownerActor(clock), clock, uow: new PrismaRegistrationUnitOfWork(prisma), storage: new MemoryStorage(), minAge: 16 },
    );

    const leads = await prisma.lead.findMany({ where: { id: { in: [recentNew.id, recentLost.id, tooOld.id] } } });
    const byId = new Map(leads.map((row) => [row.id, row]));
    expect(byId.get(recentNew.id)).toMatchObject({ status: 'CONVERTED', convertedMemberId: memberId });
    expect(byId.get(recentLost.id)).toMatchObject({ status: 'CONVERTED', convertedMemberId: memberId });
    expect(byId.get(tooOld.id)).toMatchObject({ status: 'NEW', convertedMemberId: null });
    expect((await prisma.callTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('DONE');
  });

  it('reads the rows behind the reports inside IST month and window bounds', async () => {
    const clock = fakeClockAt('2026-09-12T11:30');
    const today = todayIST(clock);
    const { memberId } = await paidAtDesk(clock, 'Desk Report');
    await markAttendance(
      { memberId, clientEventId: unique('tap') },
      { actor: ownerActor(clock), clock, uow: new PrismaAttendanceUnitOfWork(prisma), cooldownMinutes: 0 },
    );

    const inputs = await new PrismaReportsReader(prisma).inputs(gymId, monthBounds(today), {
      attendanceFrom: addDays(today, -27),
      attendanceTo: today,
      planMixFrom: addDays(today, -89),
    });

    expect(inputs.paidThisMonth).toContainEqual({ method: 'CASH', amountPaise: MONTH_PRICE });
    // Every payment in this throwaway gym was made in September.
    expect(inputs.paidLastMonth).toEqual([]);
    expect(inputs.memberships.some((row) => row.memberId === memberId)).toBe(true);
    expect(inputs.attendance.length).toBeGreaterThan(0);
    expect(inputs.planMix).toContainEqual(expect.objectContaining({ durationMonths: 1 }));
    expect(inputs.activeByGender.some((row) => row.gender === 'MALE' && row.count > 0)).toBe(true);
  });

  it('changes a plan price and the joining rules, keeps every other setting, and audits both', async () => {
    const clock = fakeClockAt('2026-09-12T11:30');
    const deps = { actor: ownerActor(clock), clock, uow: new PrismaSettingsUnitOfWork(prisma) };

    await expect(updatePlanPrices({ prices: [{ code: 'M1_MALE', pricePaise: MONTH_PRICE + 10_000 }] }, deps)).resolves.toEqual({ changed: 1 });
    expect((await prisma.plan.findUniqueOrThrow({ where: { id: MONTH_PLAN_ID } })).pricePaise).toBe(MONTH_PRICE + 10_000);

    await expect(updateGymSettings({ patch: { privacy: { minAge: 18 }, pricing: { admissionFeePaise: 20_000 } } }, deps)).resolves.toEqual({
      changedGroups: ['pricing', 'privacy'],
    });
    // The throwaway gym started with `{}`: the save writes the whole validated document.
    const settings = (await prisma.gym.findUniqueOrThrow({ where: { id: gymId }, select: { settings: true } })).settings as Record<string, unknown>;
    expect(settings['privacy']).toMatchObject({ minAge: 18, privacyNoticeVersion: '1.0' });
    expect(settings['pricing']).toMatchObject({ admissionFeePaise: 20_000, allowDeskDiscounts: true });
    expect(settings['membership']).toMatchObject({ renewalGraceDays: 5 });

    const audit = await prisma.auditLog.findMany({ where: { gymId, action: { in: ['plans.price', 'settings.update'] } }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((row) => row.action)).toEqual(['plans.price', 'settings.update']);

    // Put the price back: other tests in this file sell the plan at MONTH_PRICE.
    await updatePlanPrices({ prices: [{ code: 'M1_MALE', pricePaise: MONTH_PRICE }] }, deps);
  });

  it('adds a receptionist, resets their PIN and switches them off, signing them out each time', async () => {
    const clock = fakeClockAt('2026-09-12T11:30');
    const deps = { actor: ownerActor(clock), clock, uow: new PrismaStaffUnitOfWork(prisma) };
    // The repository stores whatever the hasher returns; Argon2 itself is tested in integrations.
    const hasher = { hash: (pin: string) => Promise.resolve(`test-hash-of-length-${pin.length}`) };
    const mobile = '+919800000001';
    const inAnHour = new Date(clock.now().getTime() + 3_600_000);

    const { staffUserId } = await addStaff({ name: 'रीना शर्मा', mobile, role: 'RECEPTION', pin: '4826' }, { ...deps, hasher });
    expect(await prisma.staffUser.findUniqueOrThrow({ where: { id: staffUserId } })).toMatchObject({
      role: 'RECEPTION',
      isActive: true,
      language: 'hi',
      pinHash: 'test-hash-of-length-4',
    });
    await expect(addStaff({ name: 'दूसरी रीना', mobile, role: 'TRAINER', pin: '1111' }, { ...deps, hasher })).rejects.toMatchObject({ code: 'CONFLICT' });

    // A lockout and a live session, to see the reset clear the first and end the second.
    await prisma.staffUser.update({ where: { id: staffUserId }, data: { failedPinCount: 4, lockedUntil: inAnHour } });
    await prisma.session.create({ data: { staffUserId, tokenHash: unique('token'), expiresAt: inAnHour } });

    await resetStaffPin({ staffUserId, pin: '739104' }, { ...deps, hasher });
    expect(await prisma.staffUser.findUniqueOrThrow({ where: { id: staffUserId } })).toMatchObject({
      pinHash: 'test-hash-of-length-6',
      failedPinCount: 0,
      lockedUntil: null,
    });
    expect(await prisma.session.count({ where: { staffUserId, revokedAt: null } })).toBe(0);

    await prisma.session.create({ data: { staffUserId, tokenHash: unique('token'), expiresAt: inAnHour } });
    await expect(setStaffActive({ staffUserId, active: false }, deps)).resolves.toEqual({ changed: true });
    expect((await prisma.staffUser.findUniqueOrThrow({ where: { id: staffUserId } })).isActive).toBe(false);
    expect(await prisma.session.count({ where: { staffUserId, revokedAt: null } })).toBe(0);

    const audit = await prisma.auditLog.findMany({ where: { gymId, entityId: staffUserId } });
    expect(audit.map((row) => row.action).sort()).toEqual(['staff.add', 'staff.deactivate', 'staff.pin_reset']);
    // Neither the PIN nor its hash is ever in the audit log.
    expect(JSON.stringify(audit)).not.toMatch(/4826|739104|test-hash/);
  });

  it('changes your own PIN: a wrong guess still counts, this session stays, the others end', async () => {
    const clock = fakeClockAt('2026-09-12T11:30');
    const inAnHour = new Date(clock.now().getTime() + 3_600_000);
    const staff = await prisma.staffUser.create({
      data: { gymId, name: 'पिन बदलने वाला', mobile: '+919800000002', role: 'RECEPTION', pinHash: 'test-hash-2468' },
    });
    const hasher = {
      hash: (pin: string) => Promise.resolve(`test-hash-${pin}`),
      verify: (stored: string, pin: string) => Promise.resolve(stored === `test-hash-${pin}`),
    };
    const thisPhone = unique('this-phone');
    const otherPhone = unique('other-phone');
    await prisma.session.createMany({
      data: [
        { staffUserId: staff.id, tokenHash: sessionTokenHash(thisPhone), expiresAt: inAnHour },
        { staffUserId: staff.id, tokenHash: sessionTokenHash(otherPhone), expiresAt: inAnHour },
      ],
    });
    const deps = {
      actor: { staffUserId: staff.id, gymId, role: 'RECEPTION' as const, elevatedUntil: null, receptionMayTakePayments: true },
      clock,
      uow: new PrismaOwnPinUnitOfWork(prisma),
      hasher,
    };

    // The wrong guess is recorded and survives: had the service thrown inside the
    // transaction, the count would have been rolled back and the lockout never reached.
    await expect(changeOwnPin({ currentPin: '1111', newPin: '8642', token: thisPhone }, deps)).rejects.toMatchObject({ code: 'INVALID_PIN' });
    expect((await prisma.staffUser.findUniqueOrThrow({ where: { id: staff.id } })).failedPinCount).toBe(1);

    await changeOwnPin({ currentPin: '2468', newPin: '8642', token: thisPhone }, deps);
    expect(await prisma.staffUser.findUniqueOrThrow({ where: { id: staff.id } })).toMatchObject({ pinHash: 'test-hash-8642', failedPinCount: 0 });

    const sessions = await prisma.session.findMany({ where: { staffUserId: staff.id } });
    expect(sessions.find((row) => row.tokenHash === sessionTokenHash(thisPhone))?.revokedAt).toBeNull();
    expect(sessions.find((row) => row.tokenHash === sessionTokenHash(otherPhone))?.revokedAt).not.toBeNull();

    const audit = await prisma.auditLog.findMany({ where: { gymId, entityId: staff.id } });
    expect(audit.map((row) => row.action)).toEqual(['staff.pin_change']);
    expect(JSON.stringify(audit)).not.toMatch(/2468|8642|test-hash/);
  });

  it('records a call outcome, snoozing the task to an IST date', async () => {
    const clock = fakeClockAt('2026-09-12T11:30');
    const { memberId } = await paidAtDesk(clock, 'Desk Call');
    const task = await prisma.callTask.create({
      data: { gymId, memberId, reason: 'EXPIRED_NOT_RENEWED', priority: 1, dueDate: new Date('2026-09-12T00:00:00Z'), status: 'OPEN' },
    });

    await recordCallOutcome({ taskId: task.id, outcome: 'WILL_RENEW' }, { actor: ownerActor(clock), clock, uow: callUow });

    const after = await prisma.callTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(after).toMatchObject({ outcome: 'WILL_RENEW', attempts: 1, status: 'OPEN' });
    expect(fromDbDate(after.snoozedUntil!)).toBe('2026-09-14');
  });

  it('closes the task and marks the member left when the call says they have left', async () => {
    const clock = fakeClockAt('2026-09-12T11:30');
    const { memberId } = await paidAtDesk(clock, 'Desk Left');
    const task = await prisma.callTask.create({
      data: { gymId, memberId, reason: 'EXPIRED_NOT_RENEWED', priority: 1, dueDate: new Date('2026-09-12T00:00:00Z'), status: 'OPEN' },
    });

    await recordCallOutcome(
      { taskId: task.id, outcome: 'LEFT_GYM', note: 'दूसरे शहर चले गए' },
      { actor: ownerActor(clock), clock, uow: callUow },
    );

    expect(await prisma.callTask.findUniqueOrThrow({ where: { id: task.id }, select: { status: true, doneById: true } })).toEqual({
      status: 'DONE',
      doneById: ownerId,
    });
    const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
    expect(member).toMatchObject({ status: 'LEFT', leftReason: 'OWNER_MARKED', leftNote: 'दूसरे शहर चले गए' });
    expect(fromDbDate(member.leftAt!)).toBe(todayIST(clock));
  });
});
