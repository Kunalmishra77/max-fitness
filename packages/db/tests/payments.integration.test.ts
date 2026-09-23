/**
 * Sign-up and payment against a real database (testing-strategy.md §5, cases P1–P8).
 *
 * The unit tests prove the rules with in-memory stores; these prove what only
 * PostgreSQL can: that the payment row lock serialises concurrent confirmations, that
 * the receipt counter hands out each number once, and that the Prisma stores map
 * every field. Payment is driven through the same core services the API routes call,
 * with a fake provider standing in for Razorpay.
 *
 * Everything is written under a throwaway gym and run-unique provider ids, and
 * deleted afterwards, so the suite is safe against a database holding other data.
 * P9 (desk payment void) belongs to the CRM fee desk and is tested with it.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { RegistrationFieldsSchema, addDays, todayIST, type Clock, type ISTDate } from '@mfp/shared';
import {
  DomainError,
  createCheckoutOrder,
  handleRazorpayWebhook,
  raiseSignupNotPaidTasks,
  receiptCounterKey,
  registerMember,
  verifyCheckout,
  type CheckoutSettings,
  type CreateOrderRequest,
  type CreatedOrder,
  type PutObjectRequest,
  type StorageDriver,
  type StoredObject,
} from '@mfp/core';
import { FakeClock, FakePaymentProvider, fakeClockAt } from '@mfp/core/testing';
import { createPrismaClient, type PrismaClient } from '../src/client';
import { fromDbDate, toDbDate } from '../src/dates';
import { PrismaSignupNotPaidStore } from '../src/repositories/call-task.repository';
import { PrismaCheckoutUnitOfWork } from '../src/repositories/checkout.repository';
import { PrismaPaymentConfirmationUnitOfWork, PrismaWebhookEventStore } from '../src/repositories/payment.repository';
import { PrismaRegistrationUnitOfWork } from '../src/repositories/registration.repository';
import { PrismaSignupReader } from '../src/repositories/signup-read.repository';
import { PrismaReceiptPdfStore, PrismaReceiptReader } from '../src/repositories/receipt.repository';
import { integrationSuite, testDatabaseUrl } from './support';

const run = randomBytes(5).toString('hex');
const gymId = `gym_it_pay_${run}`;
const eventPrefix = `evt_it_${run}`;
let sequence = 0;
const unique = (label: string) => `${label}_it_${run}_${++sequence}`;

/** Order ids are globally unique in the database, so they carry the run id. */
class RunScopedProvider extends FakePaymentProvider {
  override createOrder(request: CreateOrderRequest): Promise<CreatedOrder> {
    this.orders.push(request);
    return Promise.resolve({ providerOrderId: unique('order'), amountPaise: request.amountPaise, publicKeyId: 'rzp_test_key' });
  }
}

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

const settings: CheckoutSettings = {
  pricing: { admissionFeePaise: 0, otherGenderPricing: 'ASK_AT_DESK', allowDeskDiscounts: true },
  maxStartDateDaysAhead: 15,
  renewalGraceDays: 5,
};

const QUARTER_PLAN_ID = `${gymId}_M3_MALE`;
const QUARTER_PRICE = 400_000;
const RECEIPT_PATTERN = /^MF\/\d{4}-\d{2}\/\d{6}$/;

const suite = integrationSuite('payments (P1–P8)');

suite('sign-up and payment against the database (P1–P8)', () => {
  let prisma: PrismaClient;
  let checkoutUow: PrismaCheckoutUnitOfWork;
  let paymentUow: PrismaPaymentConfirmationUnitOfWork;

  beforeAll(async () => {
    // Enough connections for two confirmations racing plus the webhook bookkeeping.
    prisma = createPrismaClient({ connectionString: testDatabaseUrl, poolMax: 4 });
    checkoutUow = new PrismaCheckoutUnitOfWork(prisma);
    paymentUow = new PrismaPaymentConfirmationUnitOfWork(prisma);

    await prisma.gym.create({
      data: {
        id: gymId,
        slug: gymId,
        name: 'Payments integration gym',
        phone: '+919000000009',
        addressLine: 'Test',
        city: 'Test',
        state: 'Test',
        pincode: '000000',
        settings: {},
      },
    });
    await prisma.plan.createMany({
      data: [
        { id: QUARTER_PLAN_ID, gymId, code: 'M3_MALE', durationMonths: 3, gender: 'MALE', pricePaise: QUARTER_PRICE },
        { id: `${gymId}_M1_MALE`, gymId, code: 'M1_MALE', durationMonths: 1, gender: 'MALE', pricePaise: 150_000 },
      ],
    });
  });

  afterAll(async () => {
    if (prisma === undefined) return;
    await prisma.outboxEvent.deleteMany({ where: { gymId } });
    await prisma.alert.deleteMany({ where: { gymId } });
    await prisma.webhookEvent.deleteMany({ where: { externalId: { startsWith: eventPrefix } } });
    await prisma.consent.deleteMany({ where: { gymId } });
    await prisma.callTask.deleteMany({ where: { gymId } });
    await prisma.payment.deleteMany({ where: { gymId } });
    await prisma.membership.deleteMany({ where: { gymId } });
    await prisma.member.updateMany({ where: { gymId }, data: { photoMediaId: null } });
    await prisma.mediaFile.deleteMany({ where: { gymId } });
    await prisma.member.deleteMany({ where: { gymId } });
    await prisma.counter.deleteMany({ where: { gymId } });
    await prisma.plan.deleteMany({ where: { gymId } });
    await prisma.gym.deleteMany({ where: { id: gymId } });
    await prisma.$disconnect();
  });

  // ── helpers ────────────────────────────────────────────────────────────────

  const register = (clock: Clock, fullName = 'Test Member') =>
    registerMember(
      RegistrationFieldsSchema.parse({
        fullName,
        mobile: '9000010002',
        dob: '1995-05-05',
        gender: 'MALE',
        language: 'en',
        consents: { terms: true, privacy: true, whatsappUpdates: true, faceAttendance: true },
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
        channel: 'web_signup',
        source: 'WEBSITE',
        ipHash: null,
        userAgent: 'vitest',
      },
    );

  const orderFor = async (memberId: string, clock: Clock, provider: FakePaymentProvider, startDate: ISTDate | null = todayIST(clock)) => {
    const result = await createCheckoutOrder(
      { memberId, planId: QUARTER_PLAN_ID, startDate, payAtReception: false, mode: startDate === null ? 'renewal' : 'signup' },
      { clock, uow: checkoutUow, provider, settings },
    );
    if (result.kind !== 'ONLINE') throw new Error('expected an online order');
    return result;
  };

  const webhook = (
    provider: FakePaymentProvider,
    clock: Clock,
    event: string,
    entity: { id: string; order_id: string; amount?: number; error_description?: string },
    eventId: string = unique(eventPrefix),
  ) =>
    handleRazorpayWebhook(
      {
        rawBody: JSON.stringify({
          event,
          payload: { payment: { entity: { amount: QUARTER_PRICE, status: 'captured', ...entity } } },
        }),
        signature: FakePaymentProvider.VALID_WEBHOOK_SIGNATURE,
        eventId,
      },
      { provider, clock, uow: paymentUow, events: new PrismaWebhookEventStore(prisma, clock) },
    );

  const verify = (provider: FakePaymentProvider, clock: Clock, providerOrderId: string, providerPaymentId: string, signature = FakePaymentProvider.VALID_SIGNATURE) =>
    verifyCheckout({ providerOrderId, providerPaymentId, signature }, { provider, clock, uow: paymentUow });

  const counterValue = async (key: string) =>
    (await prisma.counter.findUnique({ where: { gymId_key: { gymId, key } }, select: { value: true } }))?.value ?? 0;

  /** A signed-up member with an unpaid order and a captured payment waiting at the provider. */
  const pendingPurchase = async (clock: Clock) => {
    const provider = new RunScopedProvider('razorpay');
    const { memberId } = await register(clock);
    const order = await orderFor(memberId, clock, provider);
    const providerPaymentId = unique('pay_rzp');
    provider.addPayment({ providerPaymentId, providerOrderId: order.providerOrderId, amountPaise: QUARTER_PRICE, status: 'captured' });
    return { provider, memberId, order, providerPaymentId };
  };

  // ── tests ──────────────────────────────────────────────────────────────────

  it('registers a pending member with their selfie and consents, and hints at a duplicate', async () => {
    const clock = fakeClockAt('2026-09-11T10:00');
    const first = await register(clock, 'Asha Verma');
    const second = await register(clock, 'asha verma');

    expect(first.possibleDuplicate).toBe(false);
    expect(second.possibleDuplicate).toBe(true);

    const member = await prisma.member.findUniqueOrThrow({
      where: { id: first.memberId },
      include: { photo: true, consents: true },
    });
    expect(member).toMatchObject({ status: 'PENDING_PAYMENT', source: 'WEBSITE', isMinor: false, whatsappOptIn: true, faceConsent: true });
    expect(fromDbDate(member.dob!)).toBe('1995-05-05');
    expect(member.photo).toMatchObject({ kind: 'SELFIE', mimeType: 'image/jpeg', width: 480, height: 640 });
    expect(member.consents.map((c) => c.type).sort()).toEqual(['FACE_ATTENDANCE', 'PRIVACY', 'TERMS', 'WHATSAPP_UPDATES']);
  });

  it('reuses the pending membership when the order is retried, with a new payment each time', async () => {
    const clock = fakeClockAt('2026-09-11T10:00');
    const provider = new RunScopedProvider('razorpay');
    const { memberId } = await register(clock);

    const first = await orderFor(memberId, clock, provider);
    const second = await orderFor(memberId, clock, provider);

    expect(second.membership.id).toBe(first.membership.id);
    expect(second.paymentId).not.toBe(first.paymentId);
    const payments = await prisma.payment.findMany({ where: { memberId }, select: { status: true, amountPaise: true, providerOrderId: true } });
    expect(payments).toHaveLength(2);
    expect(payments.every((p) => p.status === 'CREATED' && p.amountPaise === QUARTER_PRICE && p.providerOrderId !== null)).toBe(true);
  });

  it('P1: verify then webhook activates once, with one receipt number', async () => {
    const clock = fakeClockAt('2026-09-11T10:00');
    const { provider, memberId, order, providerPaymentId } = await pendingPurchase(clock);

    const verified = await verify(provider, clock, order.providerOrderId, providerPaymentId);
    const hooked = await webhook(provider, clock, 'payment.captured', { id: providerPaymentId, order_id: order.providerOrderId });

    expect(verified.outcome).toBe('CONFIRMED');
    expect(hooked.outcome).toBe('ALREADY_CONFIRMED');

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } });
    expect(payment).toMatchObject({ status: 'PAID', providerPaymentId, providerSignatureOk: true, method: 'RAZORPAY' });
    expect(payment.receiptNo).toMatch(RECEIPT_PATTERN);
    expect(await prisma.payment.count({ where: { gymId, receiptNo: payment.receiptNo } })).toBe(1);

    const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
    expect(member.status).toBe('ACTIVE');
    expect(member.memberCode).toMatch(/^MF-\d{4}$/);
    expect(await prisma.membership.findUniqueOrThrow({ where: { id: order.membership.id } })).toMatchObject({ status: 'CONFIRMED' });

    expect(await new PrismaSignupReader(prisma).paymentById(order.paymentId)).toEqual({
      paymentId: order.paymentId,
      memberId,
      status: 'PAID',
      amountPaise: QUARTER_PRICE,
      receiptNo: payment.receiptNo,
      memberCode: member.memberCode,
      membership: { startDate: '2026-09-11', endDate: '2026-12-10', durationMonths: 3 },
    });

    const receipt = await new PrismaReceiptReader(prisma).receipt(order.paymentId);
    expect(receipt).toEqual({
      paymentId: order.paymentId,
      gymId,
      receiptNo: payment.receiptNo,
      paidAt: clock.now(),
      amountPaise: QUARTER_PRICE,
      method: 'RAZORPAY',
      gym: { name: 'Payments integration gym', addressLine: 'Test', city: 'Test', state: 'Test', pincode: '000000', phone: '+919000000009' },
      member: { id: memberId, fullName: 'Test Member', memberCode: member.memberCode, mobile: '+919000010002', language: 'en' },
      membership: { durationMonths: 3, startDate: '2026-09-11', endDate: '2026-12-10', pricePaise: QUARTER_PRICE, admissionPaise: 0 },
      receiptPdfKey: null,
    });
    expect(await prisma.alert.findMany({ where: { gymId, memberId }, select: { type: true, title: true, params: true } })).toEqual([
      { type: 'ONLINE_PAYMENT', title: 'crm.alerts.onlinePayment', params: { paymentId: order.paymentId, receiptNo: payment.receiptNo } },
    ]);

    // The worker attaches the rendered PDF once; a second attach finds it there.
    const pdfStore = new PrismaReceiptPdfStore(prisma);
    const stored = { key: unique('receipts/pdf'), sizeBytes: 1_024, sha256: 'c'.repeat(64), mimeType: 'application/pdf' };
    const attachRecord = { paymentId: order.paymentId, gymId, memberId, stored };
    expect(await pdfStore.attachReceiptPdf(attachRecord)).toBe(true);
    expect(await pdfStore.attachReceiptPdf({ ...attachRecord, stored: { ...stored, key: unique('receipts/pdf') } })).toBe(false);
    expect((await new PrismaReceiptReader(prisma).receipt(order.paymentId))?.receiptPdfKey).toBe(stored.key);

    // An unpaid payment has no receipt.
    const unpaid = await pendingPurchase(clock);
    expect(await new PrismaReceiptReader(prisma).receipt(unpaid.order.paymentId)).toBeNull();

    const keys = (await prisma.outboxEvent.findMany({ where: { gymId, payload: { path: ['paymentId'], equals: order.paymentId } } })).map((e) => e.dedupeKey);
    // The owner hears about the payment from its Alert row, not from a second
    // outbox event with the same meaning (ADR-065).
    expect(keys.sort()).toEqual([`pdf:${order.paymentId}`, `receipt:${order.paymentId}`]);
    expect(await prisma.alert.count({ where: { gymId, memberId, type: 'ONLINE_PAYMENT' } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { dedupeKey: `enroll:${memberId}` } })).toBe(1);
  });

  it('P2: webhook then verify activates once, with one receipt number', async () => {
    const clock = fakeClockAt('2026-09-11T10:00');
    const { provider, order, providerPaymentId } = await pendingPurchase(clock);

    const hooked = await webhook(provider, clock, 'payment.captured', { id: providerPaymentId, order_id: order.providerOrderId });
    const verified = await verify(provider, clock, order.providerOrderId, providerPaymentId);

    expect(hooked.outcome).toBe('CONFIRMED');
    expect(verified).toMatchObject({ outcome: 'ALREADY_CONFIRMED', paymentId: order.paymentId });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } });
    expect(payment).toMatchObject({ status: 'PAID', providerSignatureOk: false });
    expect(verified.outcome === 'ALREADY_CONFIRMED' && verified.receiptNo).toBe(payment.receiptNo);
  });

  it('P3: two webhooks arriving together activate once, and the receipt counter moves by one', async () => {
    const clock = fakeClockAt('2026-09-11T10:00');
    const { provider, order, providerPaymentId } = await pendingPurchase(clock);
    const key = receiptCounterKey(todayIST(clock));
    const before = await counterValue(key);

    const outcomes = await Promise.all([
      webhook(provider, clock, 'payment.captured', { id: providerPaymentId, order_id: order.providerOrderId }),
      webhook(provider, clock, 'order.paid', { id: providerPaymentId, order_id: order.providerOrderId }),
    ]);

    expect(outcomes.map((o) => o.outcome).sort()).toEqual(['ALREADY_CONFIRMED', 'CONFIRMED']);
    expect(await counterValue(key)).toBe(before + 1);
    expect(await prisma.outboxEvent.count({ where: { dedupeKey: `receipt:${order.paymentId}` } })).toBe(1);
  });

  it('gives two members paying at the same moment different, consecutive receipt numbers', async () => {
    const clock = fakeClockAt('2026-09-11T10:00');
    const a = await pendingPurchase(clock);
    const b = await pendingPurchase(clock);

    const results = await Promise.all([
      webhook(a.provider, clock, 'payment.captured', { id: a.providerPaymentId, order_id: a.order.providerOrderId }),
      webhook(b.provider, clock, 'payment.captured', { id: b.providerPaymentId, order_id: b.order.providerOrderId }),
    ]);
    expect(results.map((r) => r.outcome)).toEqual(['CONFIRMED', 'CONFIRMED']);

    const numbers = (await prisma.payment.findMany({ where: { id: { in: [a.order.paymentId, b.order.paymentId] } }, select: { receiptNo: true } }))
      .map((p) => Number(p.receiptNo!.slice(-6)))
      .sort((x, y) => x - y);
    expect(numbers[1]! - numbers[0]!).toBe(1);
  });

  it('P4: an amount mismatch in the webhook does not activate, and alerts the owner', async () => {
    const clock = fakeClockAt('2026-09-11T10:00');
    const { provider, memberId, order, providerPaymentId } = await pendingPurchase(clock);

    const result = await webhook(provider, clock, 'payment.captured', { id: providerPaymentId, order_id: order.providerOrderId, amount: 100 });

    expect(result.outcome).toBe('AMOUNT_MISMATCH');
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } })).toMatchObject({
      status: 'CREATED',
      receiptNo: null,
      failureReason: 'AMOUNT_MISMATCH',
    });
    expect((await prisma.member.findUniqueOrThrow({ where: { id: memberId } })).status).toBe('PENDING_PAYMENT');
    expect(await prisma.alert.count({ where: { gymId, memberId, type: 'SYSTEM', title: 'crm.alerts.paymentAmountMismatch' } })).toBe(1);

    // order.paid reporting the same wrong amount raises nothing new.
    expect((await webhook(provider, clock, 'order.paid', { id: providerPaymentId, order_id: order.providerOrderId, amount: 100 })).outcome).toBe('AMOUNT_MISMATCH');
    expect(await prisma.alert.count({ where: { gymId, memberId, type: 'SYSTEM', title: 'crm.alerts.paymentAmountMismatch' } })).toBe(1);
    expect((await new PrismaSignupReader(prisma).paymentByOrderId(order.providerOrderId))?.status).toBe('NEEDS_REVIEW');
  });

  it('P5: an invalid checkout signature is refused and the payment stays CREATED', async () => {
    const clock = fakeClockAt('2026-09-11T10:00');
    const { provider, order, providerPaymentId } = await pendingPurchase(clock);

    const error = await verify(provider, clock, order.providerOrderId, providerPaymentId, 'forged').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('INVALID_PAYMENT_SIGNATURE');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } })).status).toBe('CREATED');
  });

  /** An active member whose only membership ended `daysAgo` days before the clock's date. */
  const activeMemberEnded = async (clock: Clock, daysAgo: number) => {
    const memberId = unique('member');
    const today = todayIST(clock);
    await prisma.member.create({
      data: {
        id: memberId,
        gymId,
        memberCode: `MF-9${String(sequence).padStart(3, '0')}`,
        fullName: 'Renewing Member',
        mobile: '+919000010003',
        gender: 'MALE',
        status: 'ACTIVE',
        source: 'CRM',
      },
    });
    await prisma.membership.create({
      data: {
        gymId,
        memberId,
        startDate: toDbDate(addDays(today, -daysAgo - 90)),
        endDate: toDbDate(addDays(today, -daysAgo)),
        pricePaise: QUARTER_PRICE,
        status: 'CONFIRMED',
        source: 'CRM',
      },
    });
    return memberId;
  };

  it('P6: a renewal within the grace period starts the day after the old end date, and keeps the member code', async () => {
    const clock = fakeClockAt('2026-09-11T10:00');
    const provider = new RunScopedProvider('razorpay');
    const memberId = await activeMemberEnded(clock, 3);
    const { memberCode } = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
    expect(await new PrismaSignupReader(prisma).renewalSubject(memberId)).toEqual({
      id: memberId,
      gymId,
      firstName: 'Renewing',
      gender: 'MALE',
      status: 'ACTIVE',
      photoKey: null,
      latestConfirmedEndDate: '2026-09-08',
    });

    const order = await orderFor(memberId, clock, provider, null);
    expect(order.membership).toMatchObject({ startDate: '2026-09-09', endDate: '2026-12-08' });

    const providerPaymentId = unique('pay_rzp');
    await webhook(provider, clock, 'payment.captured', { id: providerPaymentId, order_id: order.providerOrderId });
    const membership = await prisma.membership.findUniqueOrThrow({ where: { id: order.membership.id } });
    expect(membership.status).toBe('CONFIRMED');
    expect(fromDbDate(membership.startDate!)).toBe('2026-09-09');
    expect((await prisma.member.findUniqueOrThrow({ where: { id: memberId } })).memberCode).toBe(memberCode);
  });

  it('P7: a renewal after the grace period starts on the payment date', async () => {
    const clock = fakeClockAt('2026-09-11T10:00');
    const memberId = await activeMemberEnded(clock, 10);

    const order = await orderFor(memberId, clock, new RunScopedProvider('razorpay'), null);

    expect(order.membership.startDate).toBe('2026-09-11');
  });

  it('P8: the receipt series starts again at 1 on 1 April', async () => {
    const march31 = fakeClockAt('2027-03-31T20:00');
    const april1 = fakeClockAt('2027-04-01T09:00');
    const lastOfYear = await pendingPurchase(march31);
    const firstOfYear = await pendingPurchase(april1);

    const a = await verify(lastOfYear.provider, march31, lastOfYear.order.providerOrderId, lastOfYear.providerPaymentId);
    const b = await verify(firstOfYear.provider, april1, firstOfYear.order.providerOrderId, firstOfYear.providerPaymentId);

    expect(a.outcome === 'CONFIRMED' && a.receiptNo).toMatch(/^MF\/2026-27\/\d{6}$/);
    expect(b.outcome === 'CONFIRMED' && b.receiptNo).toBe('MF/2027-28/000001');
  });

  it('records a failed attempt, then confirms a successful retry on the same order', async () => {
    const clock = fakeClockAt('2026-09-11T10:00');
    const { provider, memberId, order, providerPaymentId } = await pendingPurchase(clock);

    const failed = await webhook(provider, clock, 'payment.failed', {
      id: unique('pay_rzp_failed'),
      order_id: order.providerOrderId,
      error_description: 'Payment was declined by the bank',
    });
    expect(failed.outcome).toBe('FAILED_RECORDED');
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } })).toMatchObject({
      status: 'FAILED',
      failureReason: 'Payment was declined by the bank',
    });

    const captured = await webhook(provider, clock, 'payment.captured', { id: providerPaymentId, order_id: order.providerOrderId });
    expect(captured.outcome).toBe('CONFIRMED');
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } })).toMatchObject({ status: 'PAID', failureReason: null });
    expect((await prisma.member.findUniqueOrThrow({ where: { id: memberId } })).status).toBe('ACTIVE');
  });

  it('raises one SIGNUP_NOT_PAID call task for a sign-up left unpaid for a day, and never a second', async () => {
    const { memberId } = await register(fakeClockAt('2026-09-11T10:00'));
    // Registration time is the database's clock; look at the job two days later.
    const twoDaysLater = new FakeClock(new Date(Date.now() + 2 * 86_400_000));
    const store = new PrismaSignupNotPaidStore(prisma, gymId);

    expect(await raiseSignupNotPaidTasks({ store, clock: twoDaysLater })).toBeGreaterThanOrEqual(1);
    const tasks = await prisma.callTask.findMany({ where: { memberId }, select: { reason: true, priority: true, status: true } });
    expect(tasks).toEqual([{ reason: 'SIGNUP_NOT_PAID', priority: 2, status: 'OPEN' }]);

    await prisma.callTask.updateMany({ where: { memberId }, data: { status: 'DONE' } });
    expect(await raiseSignupNotPaidTasks({ store, clock: twoDaysLater })).toBe(0);
    expect(await prisma.callTask.count({ where: { memberId } })).toBe(1);
  });

  it('recognises a re-delivered webhook, but processes a retry of one that never finished', async () => {
    const clock = fakeClockAt('2026-09-11T10:00');
    const { provider, order, providerPaymentId } = await pendingPurchase(clock);
    const entity = { id: providerPaymentId, order_id: order.providerOrderId };

    const unfinished = unique(eventPrefix);
    await prisma.webhookEvent.create({
      data: { provider: 'razorpay', externalId: unfinished, eventType: 'payment.captured', signatureOk: true, payload: {} },
    });
    expect((await webhook(provider, clock, 'payment.captured', entity, unfinished)).outcome).toBe('CONFIRMED');
    expect(await prisma.webhookEvent.findUniqueOrThrow({ where: { provider_externalId: { provider: 'razorpay', externalId: unfinished } } })).toMatchObject({
      error: null,
      processedAt: clock.now(),
    });

    expect((await webhook(provider, clock, 'payment.captured', entity, unfinished)).outcome).toBe('DUPLICATE');
  });
});
