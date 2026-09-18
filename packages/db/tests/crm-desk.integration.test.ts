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
import { RegistrationFieldsSchema, addDays, istDate, todayIST, type Clock } from '@mfp/shared';
import {
  addStaff,
  advanceLead,
  changeOwnPin,
  approveVerification,
  commitMemberImport,
  rejectVerification,
  submitExistingMember,
  eraseMember,
  exportMemberData,
  sessionTokenHash,
  DomainError,
  elevationExpiry,
  markAttendance,
  monthBounds,
  recordCallOutcome,
  updateGymSettings,
  updatePlanPrices,
  updateReminderSettings,
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
import { ERASED_NAME, PrismaMemberPrivacy } from '../src/repositories/member-privacy.repository';
import { PrismaMemberImport } from '../src/repositories/member-import.repository';
import { PrismaExistingMemberUnitOfWork, PrismaVerificationQueue, PrismaVerificationUnitOfWork } from '../src/repositories/verification.repository';
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
    await prisma.verificationRequest.deleteMany({ where: { gymId } });
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
    await prisma.reminderRule.deleteMany({ where: { gymId } });
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

  it("exports a member's data, then erases the person and keeps the accounts", async () => {
    const clock = fakeClockAt('2026-09-12T11:30');
    const actor = ownerActor(clock);
    const privacy = new PrismaMemberPrivacy(prisma);
    const { memberId, paymentId, receiptNo } = await paidAtDesk(clock, 'Desk Erase');

    // Things erasure must reach: a face template, an alert naming them, a linked enquiry.
    await prisma.faceTemplate.create({
      data: { gymId, memberId, vectorEnc: Buffer.from([1, 2, 3]), dimensions: 3, modelVersion: 'test', qualityScore: 0.9, sourceKind: 'signup_selfie' },
    });
    await prisma.alert.create({ data: { gymId, memberId, type: 'NEW_LEAD', title: 'alert.test', params: { name: 'Desk Erase' } } });
    await prisma.lead.create({ data: { gymId, name: 'Desk Erase', mobile: '+919000020002', source: 'PHONE', status: 'CONVERTED', convertedMemberId: memberId } });

    const exported = await exportMemberData({ memberId }, { actor, clock, store: privacy.store });
    expect(exported.data.member).toMatchObject({ fullName: 'Desk Erase', hasPhoto: true });
    expect(exported.data.payments).toContainEqual(expect.objectContaining({ receiptNo, status: 'PAID' }));
    expect(exported.data.consents.length).toBeGreaterThan(0);
    expect(exported.data.faceTemplates).toEqual({ count: 1 });

    const result = await eraseMember({ memberId, reason: 'सदस्य ने कहा' }, { actor, clock, uow: privacy, storage: new MemoryStorage() });
    expect(result).toMatchObject({ filesNotDeleted: [], faceTemplatesDeleted: 1 });
    expect(result.filesDeleted).toBeGreaterThan(0);

    const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
    expect(member).toMatchObject({ fullName: ERASED_NAME, email: null, dob: null, photoMediaId: null, whatsappOptIn: false, faceConsent: false, status: 'LEFT' });
    expect(member.mobile).not.toContain('9000020002');
    expect(member.deletedAt).not.toBeNull();
    // The pseudonymous code stays, so the accounts still add up.
    expect(member.memberCode).not.toBeNull();

    expect(await prisma.mediaFile.count({ where: { memberId, deletedAt: null } })).toBe(0);
    expect(await prisma.faceTemplate.count({ where: { memberId } })).toBe(0);
    expect((await prisma.alert.findFirstOrThrow({ where: { memberId } })).params).toBeNull();
    expect(await prisma.lead.findFirstOrThrow({ where: { convertedMemberId: memberId } })).toMatchObject({ name: ERASED_NAME, notes: null });

    // Kept: consents as minimal proof, and the payment with its receipt number.
    expect(await prisma.consent.count({ where: { memberId } })).toBeGreaterThan(0);
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({ status: 'PAID', receiptNo });

    const audit = await prisma.auditLog.findMany({ where: { gymId, entityId: memberId, action: { in: ['member.export', 'member.erase'] } } });
    expect(audit.map((row) => row.action).sort()).toEqual(['member.erase', 'member.export']);
    expect(JSON.stringify(audit)).not.toMatch(/Desk Erase|9000020002/);

    // Once erased, there is nothing to export and nothing to erase again.
    await expect(exportMemberData({ memberId }, { actor, clock, store: privacy.store })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(eraseMember({ memberId, reason: 'again' }, { actor, clock, uow: privacy, storage: new MemoryStorage() })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('moves reminder times and the days after expiry, keeping the POST rule and settings in step, and stops automatic messages', async () => {
    const clock = fakeClockAt('2026-09-12T11:30');
    const deps = { actor: ownerActor(clock), clock, uow: new PrismaSettingsUnitOfWork(prisma) };
    await prisma.reminderRule.createMany({
      data: [
        { gymId, code: 'PRE_7', offsetDays: -7, offsetDaysTo: -7, slots: ['10:00'], templateName: 'mf_renewal_due' },
        { gymId, code: 'POST', offsetDays: 1, offsetDaysTo: 7, slots: ['10:00', '19:00'], templateName: 'mf_renewal_expired' },
      ],
    });
    const rulesNow = async () =>
      (await prisma.reminderRule.findMany({ where: { gymId }, orderBy: { offsetDays: 'asc' } })).map((rule) => ({
        code: rule.code,
        slots: rule.slots,
        isEnabled: rule.isEnabled,
        offsetDaysTo: rule.offsetDaysTo,
      }));

    // A time outside quiet hours changes nothing at all.
    await expect(
      updateReminderSettings({ rules: [{ code: 'PRE_7', slots: ['22:00'], isEnabled: true }], postExpiryMaxDays: 12 }, deps),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await rulesNow())[1]?.offsetDaysTo).toBe(7);

    await expect(
      updateReminderSettings(
        {
          rules: [
            { code: 'PRE_7', slots: ['11:30'], isEnabled: false },
            { code: 'POST', slots: ['19:00', '10:00'], isEnabled: true },
          ],
          postExpiryMaxDays: 12,
        },
        deps,
      ),
    ).resolves.toEqual({ changed: true });
    expect(await rulesNow()).toEqual([
      { code: 'PRE_7', slots: ['11:30'], isEnabled: false, offsetDaysTo: -7 },
      { code: 'POST', slots: ['10:00', '19:00'], isEnabled: true, offsetDaysTo: 12 },
    ]);

    await expect(updateGymSettings({ patch: { reminders: { automaticPaused: true } } }, deps)).resolves.toEqual({ changedGroups: ['reminders'] });
    const stored = (await prisma.gym.findUniqueOrThrow({ where: { id: gymId } })).settings as { reminders: { automaticPaused: boolean; postExpiryMaxDays: number } };
    // The kill switch and the cap live side by side; saving one kept the other.
    expect(stored.reminders).toMatchObject({ automaticPaused: true, postExpiryMaxDays: 12 });
    expect(await prisma.auditLog.count({ where: { gymId, action: 'reminders.update' } })).toBe(1);
  });

  it('imports the paper register: active members, declared memberships, codes in a block, desk consent, and no duplicates', async () => {
    const clock = fakeClockAt('2026-09-12T11:30');
    const uow = new PrismaMemberImport(prisma);
    const csv = [
      'full_name,mobile,gender,dob,email,plan_months,month_end_date,last_amount,joined_on,notes',
      'Import One,9000040001,M,14-02-1984,,3,30-09-2026,4000,05-06-2019,Morning batch',
      'Import Two,9000040002,F,,,,18-09-2026,,,',
      'Import Three,9000040002,F,,,12,15-03-2027,13500,,',
    ].join('\n');
    const deps = { actor: ownerActor(clock), clock, uow, noticeVersion: '1.0' };

    const first = await commitMemberImport({ csv, deskConsent: true }, deps);
    expect(first).toMatchObject({ created: 3, skipped: 0 });

    const members = await prisma.member.findMany({
      where: { gymId, source: 'IMPORT' },
      include: { memberships: true, consents: true },
      orderBy: { memberCode: 'asc' },
    });
    expect(members.map((m) => m.fullName)).toEqual(['Import One', 'Import Two', 'Import Three']);
    expect(members.every((m) => m.status === 'ACTIVE' && m.whatsappOptIn && m.createdById === ownerId)).toBe(true);
    // One block of codes, consecutive.
    const codes = members.map((m) => Number(m.memberCode?.slice(3)));
    expect(codes).toEqual([codes[0], (codes[0] ?? 0) + 1, (codes[0] ?? 0) + 2]);
    expect(members[0]?.notes).toBe('Joined 05-06-2019 · Morning batch');

    const one = members[0]?.memberships[0];
    expect(one).toMatchObject({ status: 'CONFIRMED', source: 'IMPORT', isDeclared: true, durationMonths: 3, pricePaise: 400_000 });
    const oneStart = one?.startDate ?? null;
    expect(oneStart === null ? null : fromDbDate(oneStart)).toBe('2026-07-01');
    expect(one === undefined ? null : fromDbDate(one.endDate)).toBe('2026-09-30');
    expect(members[1]?.memberships[0]?.startDate).toBeNull();
    expect(members[2]?.consents).toEqual([expect.objectContaining({ type: 'WHATSAPP_UPDATES', granted: true, channel: 'crm_desk', recordedById: ownerId })]);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { gymId, action: 'member.import', entityId: first.importId } });
    expect(audit.after).toEqual({ rows: 3, created: 3, skipped: 0, deskConsent: true });
    expect(JSON.stringify(audit)).not.toMatch(/Import One|9000040001/);

    // The same file again changes nothing.
    await expect(commitMemberImport({ csv, deskConsent: true }, deps)).resolves.toMatchObject({ created: 0, skipped: 3 });
    expect(await prisma.member.count({ where: { gymId, source: 'IMPORT' } })).toBe(3);
  });

  it('takes an existing member through the QR and the verify queue: new, matched to the register, and rejected', async () => {
    const clock = fakeClockAt('2026-09-12T11:30');
    const actor = ownerActor(clock);
    const qr = new PrismaExistingMemberUnitOfWork(prisma);
    const queue = new PrismaVerificationQueue(prisma);
    const decide = { actor, clock, uow: new PrismaVerificationUnitOfWork(prisma) };
    const storage = new MemoryStorage();
    const person = (fullName: string, mobile: string) =>
      RegistrationFieldsSchema.parse({
        fullName,
        mobile,
        dob: '1990-01-01',
        gender: 'MALE',
        language: 'hi',
        consents: { terms: true, privacy: true, whatsappUpdates: true, faceAttendance: false },
        noticeVersion: '1.0',
      });
    const submit = (fullName: string, mobile: string, declaredEndDate: string) =>
      submitExistingMember(
        { fields: person(fullName, mobile), selfie: { body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 720, height: 720 }, declaredPlanMonths: 3, declaredEndDate: istDate(declaredEndDate), declaredAmountPaise: 400_000 },
        { clock, uow: qr, storage, gymId, minAge: 16, ipHash: null, userAgent: 'vitest' },
      );

    // 1. Someone the system has never seen.
    const fresh = await submit('Qr Fresh', '9000060001', '2026-09-30');
    expect(fresh.referenceCode).toMatch(/^Q-\d{4}$/);
    expect(fresh.matchedExisting).toBe(false);
    // Scanning again is the same request.
    await expect(submit('qr  fresh', '9000060001', '2026-09-30')).resolves.toEqual(fresh);
    const freshMember = await prisma.member.findFirstOrThrow({ where: { gymId, mobile: '+919000060001' } });
    expect(freshMember).toMatchObject({ status: 'PENDING_VERIFICATION', source: 'QR_EXISTING' });
    expect(await prisma.verificationRequest.count({ where: { gymId, memberId: freshMember.id } })).toBe(1);
    expect(await prisma.alert.count({ where: { gymId, memberId: freshMember.id, type: 'VERIFICATION_PENDING' } })).toBe(1);

    const freshItem = (await queue.pending(gymId)).find((item) => item.referenceCode === fresh.referenceCode);
    expect(freshItem).toMatchObject({ declaredEndDate: '2026-09-30', register: null, member: { fullName: 'Qr Fresh' } });
    expect(freshItem?.member.photoKey).not.toBeNull();

    const approved = await approveVerification({ verificationId: freshItem?.id ?? '', approvedEndDate: istDate('2026-09-28') }, decide);
    expect(approved.memberCode).toMatch(/^MF-\d{4}$/);
    const afterApprove = await prisma.member.findUniqueOrThrow({ where: { id: freshMember.id }, include: { memberships: true } });
    expect(afterApprove.status).toBe('ACTIVE');
    expect(afterApprove.memberships).toHaveLength(1);
    expect(afterApprove.memberships[0]).toMatchObject({ status: 'CONFIRMED', source: 'QR_EXISTING', isDeclared: true, pricePaise: 400_000 });
    expect(fromDbDate(afterApprove.memberships[0]?.endDate ?? new Date(0))).toBe('2026-09-28');
    expect(fromDbDate(afterApprove.memberships[0]?.declaredEndDate ?? new Date(0))).toBe('2026-09-30');
    expect(await prisma.verificationRequest.findUniqueOrThrow({ where: { id: freshItem?.id ?? '' } })).toMatchObject({ status: 'APPROVED', decidedById: ownerId });
    expect(await prisma.outboxEvent.count({ where: { gymId, dedupeKey: 'verification-approved:' + (freshItem?.id ?? '') } })).toBe(1);
    await expect(approveVerification({ verificationId: freshItem?.id ?? '' }, decide)).rejects.toMatchObject({ code: 'CONFLICT' });

    // 2. Someone already in the paper register.
    await commitMemberImport(
      { csv: 'full_name,mobile,gender,month_end_date,plan_months\nVerify Match,9000060002,M,20-09-2026,1\n', deskConsent: false },
      { actor, clock, uow: new PrismaMemberImport(prisma), noticeVersion: '1.0' },
    );
    const matched = await submit('verify match', '9000060002', '2026-09-25');
    expect(matched.matchedExisting).toBe(true);
    expect(await prisma.member.count({ where: { gymId, mobile: '+919000060002' } })).toBe(1);
    const matchedItem = (await queue.pending(gymId)).find((item) => item.referenceCode === matched.referenceCode);
    expect(matchedItem?.register).toMatchObject({ endDate: '2026-09-20', planMonths: 1 });

    await approveVerification({ verificationId: matchedItem?.id ?? '', approvedEndDate: istDate('2026-09-20') }, decide);
    const imported = await prisma.member.findFirstOrThrow({ where: { gymId, mobile: '+919000060002' }, include: { memberships: true } });
    // Still one membership: the register's, now carrying the member's own confirmation.
    expect(imported.memberships).toHaveLength(1);
    expect(imported).toMatchObject({ status: 'ACTIVE', whatsappOptIn: true });

    // 3. A submission staff cannot match.
    const doubtful = await submit('Qr Doubtful', '9000060003', '2026-09-30');
    const doubtfulItem = (await queue.pending(gymId)).find((item) => item.referenceCode === doubtful.referenceCode);
    await rejectVerification({ verificationId: doubtfulItem?.id ?? '', reason: 'रजिस्टर में नहीं मिला' }, decide);
    expect(await prisma.verificationRequest.findUniqueOrThrow({ where: { id: doubtfulItem?.id ?? '' } })).toMatchObject({ status: 'REJECTED', rejectReason: 'रजिस्टर में नहीं मिला' });
    expect(await prisma.member.findFirstOrThrow({ where: { gymId, mobile: '+919000060003' } })).toMatchObject({ status: 'PENDING_VERIFICATION' });
    expect(await queue.count(gymId)).toBe(0);
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
