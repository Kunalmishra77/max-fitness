import {
  CALL_TASK_PRIORITY,
  DEFAULT_REMINDER_RULES,
  FEE_STATES,
  addDays,
  addMonthsClamped,
  dayOfWeek,
  diffDays,
  fyLabel,
  istDateOf,
  istTime,
  minutesOfDay,
  planCode,
  slotToUtc,
  toE164,
  toISTTime,
  type CallTaskReason,
  type FeeState,
  type ISTDate,
  type PlanCode,
  type PlanDurationMonths,
} from '@mfp/shared';
import {
  daysUntilBirthday,
  declaredMembershipPeriod,
  feeState,
  formatMemberCode,
  formatReceiptNumber,
  hasBirthdayToday,
  hasBirthdayWithin,
  isMinorOn,
  matchingRules,
  membershipEndDate,
  reminderIdempotencyKey,
  type MembershipForFeeState,
  type ReminderRule,
} from '@mfp/core';
import type { DemoMemberRow } from './csv';
import { LEAD_GOALS, LEAD_NAMES, LEFT_OWNER_REASONS } from './names';
import type { Rng } from './rng';

/**
 * Builds the whole demo dataset in memory, with no database access.
 *
 * Separating "decide what the data is" from "write it" keeps the seed fast against
 * a remote Supabase database (override 5): every row is computed up front and then
 * inserted with a handful of chunked `createMany` calls, instead of thousands of
 * round trips. It also means the business rules used here are the real ones from
 * `packages/core` — membership end dates, fee state, reminder rule matching and
 * idempotency keys — so the demo cannot drift from what the product will do.
 *
 * Everything is relative to `today` (demo-data-seed-spec.md): open the app on any
 * day and the tiles are populated.
 */

// ── Row shapes (column names match schema.prisma exactly) ─────────────────────

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface MemberRow {
  id: string;
  gymId: string;
  memberCode: string | null;
  fullName: string;
  mobile: string;
  email: string | null;
  dob: Date | null;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  language: 'hi' | 'en';
  status: 'PENDING_PAYMENT' | 'PENDING_VERIFICATION' | 'ACTIVE' | 'LEFT' | 'BLOCKED';
  source: MemberSource;
  isMinor: boolean;
  whatsappOptIn: boolean;
  faceConsent: boolean;
  remindersUnsubscribedAt: Date | null;
  remindersPausedUntil: Date | null;
  leftAt: Date | null;
  leftReason: LeftReason | null;
  notes: string | null;
  lastAttendanceAt: Date | null;
  createdById: string | null;
  createdAt: Date;
}

type MemberSource = 'WEBSITE' | 'QR_NEW' | 'QR_EXISTING' | 'WALK_IN' | 'IMPORT' | 'CRM';
type LeftReason =
  | 'WHATSAPP_UNSUBSCRIBE'
  | 'OWNER_MARKED'
  | 'LAPSED'
  | 'MOVED_AWAY'
  | 'PRICE'
  | 'HEALTH'
  | 'NOT_SATISFIED'
  | 'OTHER';

export interface MembershipRow {
  id: string;
  gymId: string;
  memberId: string;
  planId: string | null;
  durationMonths: number | null;
  startDate: Date | null;
  endDate: Date;
  pricePaise: number;
  discountPaise: number;
  admissionPaise: number;
  status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED';
  source: MemberSource;
  isDeclared: boolean;
  declaredEndDate: Date | null;
  createdById: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
}

export interface PaymentRow {
  id: string;
  gymId: string;
  memberId: string;
  membershipId: string | null;
  amountPaise: number;
  method: 'RAZORPAY' | 'CASH' | 'UPI_DIRECT' | 'CARD_POS' | 'BANK_TRANSFER' | 'SIMULATED';
  status: 'CREATED' | 'PAID' | 'FAILED' | 'VOIDED' | 'REFUNDED';
  receiptNo: string | null;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  providerSignatureOk: boolean;
  paidAt: Date | null;
  recordedById: string | null;
  createdAt: Date;
}

export interface ConsentRow {
  id: string;
  gymId: string;
  memberId: string;
  type: 'TERMS' | 'PRIVACY' | 'WHATSAPP_UPDATES' | 'FACE_ATTENDANCE' | 'PARENTAL' | 'PHOTO_MARKETING';
  granted: boolean;
  noticeVersion: string;
  channel: string;
  recordedById: string | null;
  createdAt: Date;
}

export interface AttendanceRow {
  id: string;
  gymId: string;
  memberId: string;
  kioskDeviceId: string | null;
  clientEventId: string;
  method: 'FACE' | 'FACE_CONFIRMED' | 'KEYPAD' | 'MANUAL';
  capturedAt: Date;
  attendanceDate: Date;
  matchScore: number | null;
  feeStateAtCheckIn: FeeState;
  recordedById: string | null;
  createdAt: Date;
}

export interface VerificationRow {
  id: string;
  gymId: string;
  memberId: string;
  referenceCode: string;
  declaredPlanMonths: number;
  declaredEndDate: Date;
  declaredAmountPaise: number;
  matchedImportMemberId: string | null;
  status: 'PENDING';
  createdAt: Date;
}

export interface LeadRow {
  id: string;
  gymId: string;
  name: string;
  mobile: string;
  goal: string;
  source: 'WEBSITE_HERO' | 'WEBSITE_OTHER' | 'WALK_IN' | 'INSTAGRAM' | 'GBP';
  status: 'NEW' | 'CONTACTED' | 'TRIAL_BOOKED' | 'VISITED' | 'CONVERTED' | 'LOST';
  utm: JsonObject | null;
  followUpAt: Date | null;
  convertedMemberId: string | null;
  createdAt: Date;
}

type MessageStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'SKIPPED' | 'SIMULATED';

export interface MessageRow {
  id: string;
  gymId: string;
  memberId: string | null;
  membershipId: string | null;
  direction: 'OUTBOUND' | 'INBOUND';
  purpose:
    | 'REMINDER'
    | 'RECEIPT'
    | 'WELCOME'
    | 'VERIFICATION'
    | 'OWNER_DIGEST'
    | 'UNSUBSCRIBE_CONFIRM'
    | 'OTHER';
  ruleCode: string | null;
  templateName: string | null;
  language: 'hi' | 'en' | null;
  toNumber: string | null;
  fromNumber: string | null;
  idempotencyKey: string | null;
  providerMessageId: string | null;
  status: MessageStatus;
  bodyPreview: string | null;
  payload: JsonObject | null;
  errorCode: string | null;
  errorMessage: string | null;
  scheduledFor: Date | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface CallTaskRow {
  id: string;
  gymId: string;
  memberId: string | null;
  leadId: string | null;
  reason: CallTaskReason;
  priority: number;
  status: 'OPEN' | 'DONE' | 'SKIPPED' | 'AUTO_CLOSED';
  dueDate: Date;
  attempts: number;
  outcome: 'WILL_RENEW' | 'CALL_LATER' | 'NO_ANSWER' | 'LEFT_GYM' | 'WRONG_NUMBER' | 'DONE' | null;
  note: string | null;
  doneById: string | null;
  doneAt: Date | null;
  createdAt: Date;
}

export interface AlertRow {
  id: string;
  gymId: string;
  type:
    | 'EXPIRED_MEMBER_VISIT'
    | 'ONLINE_PAYMENT'
    | 'NEW_LEAD'
    | 'VERIFICATION_PENDING'
    | 'MEMBER_UNSUBSCRIBED'
    | 'KIOSK_OFFLINE';
  memberId: string | null;
  title: string;
  params: JsonObject | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface CounterRow {
  id: string;
  gymId: string;
  key: string;
  value: number;
}

export interface SeedContext {
  readonly gymId: string;
  readonly today: ISTDate;
  /** The seed's "now". Real now when seeding today; 19:30 IST on SEED_TODAY otherwise. */
  readonly now: Date;
  readonly rng: Rng;
  readonly plans: ReadonlyMap<PlanCode, { readonly id: string; readonly pricePaise: number }>;
  readonly ownerId: string;
  readonly receptionId: string;
  readonly ownerMobile: string;
  readonly kioskId: string;
  readonly postExpiryMaxDays: number | null;
}

export interface SeedSummary {
  readonly membersByStatus: Record<string, number>;
  /** ACTIVE members only, computed by the canonical `feeState()` (ADR-013). */
  readonly feeStates: Record<FeeState, number>;
  readonly birthdaysToday: number;
  readonly birthdaysThisWeek: number;
  readonly openCallTasks: number;
  readonly openCallTasksByReason: Record<string, number>;
  readonly collectionsThisMonthPaise: number;
  readonly paymentsThisMonth: number;
  readonly attendanceToday: number;
  readonly unreadAlerts: number;
}

export interface SeedDataset {
  readonly members: MemberRow[];
  readonly memberships: MembershipRow[];
  readonly payments: PaymentRow[];
  readonly consents: ConsentRow[];
  readonly attendance: AttendanceRow[];
  readonly verifications: VerificationRow[];
  readonly leads: LeadRow[];
  readonly messages: MessageRow[];
  readonly callTasks: CallTaskRow[];
  readonly alerts: AlertRow[];
  readonly counters: CounterRow[];
  readonly summary: SeedSummary;
}

// ── Small helpers ─────────────────────────────────────────────────────────────

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** A `@db.Date` value. Prisma writes the UTC date part, so midnight UTC is the calendar date. */
export const dbDate = (d: ISTDate): Date => new Date(`${d}T00:00:00.000Z`);

const yearOf = (d: ISTDate): number => Number(d.slice(0, 4));
const monthOf = (d: ISTDate): number => Number(d.slice(5, 7));
const dayOf = (d: ISTDate): number => Number(d.slice(8, 10));

/** An IST wall-clock moment on `date`, as a UTC instant. */
function at(date: ISTDate, minuteOfDay: number, seconds = 0): Date {
  const minute = Math.max(0, Math.min(23 * 60 + 59, minuteOfDay));
  const slot = istTime(`${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`);
  return new Date(slotToUtc(date, slot).getTime() + seconds * 1000);
}

/** A calendar date, stepping back from day 31/30/29 when the month is shorter. */
function safeDate(year: number, month: number, day: number): ISTDate {
  for (let d = day; d >= 28; d -= 1) {
    try {
      return istDateOf(year, month, d);
    } catch {
      // Not a real date in this month; try the day before.
    }
  }
  return istDateOf(year, month, Math.min(day, 28));
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function displayDate(d: ISTDate): string {
  return `${dayOf(d)} ${MONTHS_SHORT[monthOf(d) - 1] ?? ''} ${yearOf(d)}`;
}

const firstName = (fullName: string): string => fullName.split(/\s+/)[0] ?? fullName;

/** The id every seeded member gets: stable across re-seeds, so links in screenshots survive. */
export const memberIdFor = (ref: string): string => `mbr_${ref.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

/**
 * A start date whose BR-3.1 end date is exactly `end`.
 *
 * Working backwards from an end date with `addMonths(end + 1, −months)` is not an
 * exact inverse at month ends (clamping loses information), so nearby candidates
 * are tried until `membershipEndDate(start, months)` really equals `end`.
 */
function startForEnd(end: ISTDate, months: PlanDurationMonths): ISTDate {
  const guess = declaredMembershipPeriod(end, months).startDate;
  if (guess === null) {
    throw new Error('declaredMembershipPeriod returned no start for a known duration');
  }
  for (const delta of [0, 1, -1, 2, -2, 3, -3]) {
    const candidate = addDays(guess, delta);
    if (membershipEndDate(candidate, months) === end) return candidate;
  }
  return guess;
}

interface Period {
  readonly id: string;
  readonly start: ISTDate;
  readonly end: ISTDate;
  readonly months: PlanDurationMonths;
  readonly planId: string | null;
  readonly pricePaise: number;
  readonly paidOn: ISTDate;
  readonly paidAt: Date;
  readonly isFirst: boolean;
}


const REMINDER_SLOTS = ['09:30', '10:00', '14:00', '19:00'] as const;

// ── The builder ───────────────────────────────────────────────────────────────

export function buildDataset(rows: readonly DemoMemberRow[], ctx: SeedContext): SeedDataset {
  const { gymId, today: T, now, rng } = ctx;
  const nowMinute = minutesOfDay(toISTTime(now));

  const seq = { membership: 0, payment: 0, consent: 0, attendance: 0, message: 0, task: 0, alert: 0 };
  const nextId = (prefix: keyof typeof seq, tag: string): string => {
    seq[prefix] += 1;
    return `${tag}_${String(seq[prefix]).padStart(6, '0')}`;
  };

  const members: MemberRow[] = [];
  const memberships: MembershipRow[] = [];
  const payments: PaymentRow[] = [];
  const consents: ConsentRow[] = [];
  const attendance: AttendanceRow[] = [];
  const verifications: VerificationRow[] = [];
  const messages: MessageRow[] = [];
  const callTasks: CallTaskRow[] = [];
  const alerts: AlertRow[] = [];

  const openTaskKeys = new Set<string>();
  const addTask = (task: Omit<CallTaskRow, 'id' | 'gymId' | 'priority'>): void => {
    const key = `${task.memberId ?? task.leadId ?? ''}:${task.reason}`;
    // The partial unique index allows only one OPEN task per (member, reason) — BR-7.
    if (task.status === 'OPEN') {
      if (openTaskKeys.has(key)) return;
      openTaskKeys.add(key);
    }
    callTasks.push({ id: nextId('task', 'ct'), gymId, priority: CALL_TASK_PRIORITY[task.reason], ...task });
  };

  const reminderRules: ReminderRule[] = DEFAULT_REMINDER_RULES.map((r) => ({
    code: r.code,
    offsetDays: r.offsetDays,
    offsetDaysTo: r.code === 'POST' ? ctx.postExpiryMaxDays : r.offsetDaysTo,
    slots: r.slots,
    templateName: r.templateName,
    isEnabled: true,
  }));

  const planFor = (gender: DemoMemberRow['gender'], months: PlanDurationMonths) => {
    const code = planCode(months, gender === 'FEMALE' ? 'FEMALE' : 'MALE');
    const plan = ctx.plans.get(code);
    if (plan === undefined) throw new Error(`Plan ${code} was not created`);
    return plan;
  };

  /** Seed spec §4: older years were cheaper, by up to 10%. Rounded to ₹10; integer paise. */
  const historicPrice = (basePaise: number, paidOn: ISTDate): number => {
    const yearsAgo = Math.max(0, yearOf(T) - yearOf(paidOn));
    const factor = 1 - Math.min(0.1, yearsAgo * 0.01);
    return Math.max(1000, Math.round((basePaise * factor) / 1000) * 1000);
  };

  /** A payment instant on `date` between 06:00 and 21:00 IST that is never in the future. */
  const paymentInstant = (date: ISTDate): { paidOn: ISTDate; paidAt: Date } => {
    let paidOn = date > T ? T : date;
    let minute = rng.int(6 * 60, 21 * 60);
    if (paidOn === T && minute > nowMinute - 15) {
      if (nowMinute - 15 < 6 * 60) {
        paidOn = addDays(T, -1);
      } else {
        minute = rng.int(6 * 60, nowMinute - 15);
      }
    }
    return { paidOn, paidAt: at(paidOn, minute, rng.int(0, 59)) };
  };

  const healthyIds = rows.filter((r) => r.scenario === 'ACTIVE_HEALTHY').map((r) => memberIdFor(r.memberRef));
  const seenSharedMobiles = new Set<string>();
  let expired13Forced = 0;

  interface Built {
    readonly row: DemoMemberRow;
    readonly member: MemberRow;
    readonly periods: Period[];
    readonly unsubscribedAt: Date | null;
    readonly pausedFrom: ISTDate | null;
  }
  const built: Built[] = [];

  for (const row of rows) {
    const memberId = memberIdFor(row.memberRef);
    const scenario = row.scenario;
    const months = row.planMonths;
    const span = diffDays(membershipEndDate(T, months), T);
    const healthyEnd = (min: number, max: number): ISTDate =>
      addDays(T, rng.int(min, Math.max(min, Math.min(max, span))));

    // ── Latest membership end date, per scenario (seed spec §3) ──────────────
    let latestEnd: ISTDate | null = null;
    switch (scenario) {
      case 'ACTIVE_HEALTHY':
      case 'BIRTHDAY_WEEK':
        latestEnd = healthyEnd(8, 170);
        break;
      case 'MINOR_GUARDIAN_PENDING':
        latestEnd = healthyEnd(8, 60);
        break;
      case 'BIRTHDAY_TODAY':
        latestEnd = healthyEnd(10, 90);
        break;
      case 'ABSENT_10':
        latestEnd = healthyEnd(15, 120);
        break;
      case 'DUE_7':
        latestEnd = addDays(T, 7);
        break;
      case 'DUE_3':
        latestEnd = addDays(T, 3);
        break;
      case 'DUE_2':
      case 'RENEWED_EARLY':
      case 'PAUSED_REMINDERS':
        latestEnd = addDays(T, 2);
        break;
      case 'DUE_1':
        latestEnd = addDays(T, 1);
        break;
      case 'DUE_TODAY':
        latestEnd = T;
        break;
      case 'EXPIRED_1_3':
        // Two of these carry an EXPIRED_NOT_RENEWED task, which BR-7 raises on day +3.
        latestEnd = expired13Forced < 2 ? addDays(T, -3) : addDays(T, -rng.int(1, 3));
        expired13Forced += 1;
        break;
      case 'EXPIRED_4_7':
        latestEnd = addDays(T, -rng.int(4, 7));
        break;
      case 'EXPIRED_BUT_VISITING':
        latestEnd = addDays(T, -rng.int(2, 6));
        break;
      case 'EXPIRED_8_40':
        latestEnd = addDays(T, -rng.int(8, 40));
        break;
      case 'LEFT_UNSUBSCRIBED':
        latestEnd = addDays(T, -rng.int(5, 30));
        break;
      case 'LEFT_OWNER':
        latestEnd = addDays(T, -rng.int(30, 200));
        break;
      case 'SHARED_NUMBER_PAIR':
        // One member of each pair is due soon, the other healthy (seed spec §3).
        if (seenSharedMobiles.has(row.mobile)) {
          latestEnd = healthyEnd(20, 120);
        } else {
          seenSharedMobiles.add(row.mobile);
          latestEnd = addDays(T, 3);
        }
        break;
      case 'PENDING_VERIFICATION':
      case 'PENDING_PAYMENT':
        latestEnd = null;
        break;
    }

    // ── Membership chain back to the year they joined (seed spec §4) ─────────
    const periods: Period[] = [];
    if (latestEnd !== null) {
      const raw: Array<{ start: ISTDate; end: ISTDate; months: PlanDurationMonths }> = [];
      let end = latestEnd;
      let m: PlanDurationMonths = months;
      for (let i = 0; i < 240; i += 1) {
        const start = startForEnd(end, m);
        raw.unshift({ start, end, months: m });
        if (yearOf(start) <= row.joinedYear) break;
        end = addDays(start, -1);
        // 70% repeat the same plan, 30% vary it.
        m = rng.chance(0.7) ? months : rng.pick([1, 3, 6, 12] as const);
      }

      raw.forEach((p, index) => {
        const plan = planFor(row.gender, p.months);
        const { paidOn, paidAt } = paymentInstant(index === 0 ? p.start : addDays(p.start, rng.int(-2, 1)));
        periods.push({
          id: nextId('membership', 'ms'),
          start: p.start,
          end: p.end,
          months: p.months,
          planId: plan.id,
          pricePaise: historicPrice(plan.pricePaise, paidOn),
          paidOn,
          paidAt,
          isFirst: index === 0,
        });
      });

      if (scenario === 'RENEWED_EARLY') {
        // The proof that renewal stops reminders: an upcoming membership starting the
        // day after the current one ends, paid a few days ago (BR-3.5, case R9).
        const start = addDays(latestEnd, 1);
        const plan = planFor(row.gender, months);
        const { paidOn, paidAt } = paymentInstant(addDays(T, -rng.int(1, 3)));
        periods.push({
          id: nextId('membership', 'ms'),
          start,
          end: membershipEndDate(start, months),
          months,
          planId: plan.id,
          pricePaise: plan.pricePaise,
          paidOn,
          paidAt,
          isFirst: false,
        });
      }
    }

    // ── Person ────────────────────────────────────────────────────────────────
    const dob = dobFor(row, T, rng);
    const status: MemberRow['status'] = scenario.startsWith('LEFT_')
      ? 'LEFT'
      : scenario === 'PENDING_VERIFICATION'
        ? 'PENDING_VERIFICATION'
        : scenario === 'PENDING_PAYMENT'
          ? 'PENDING_PAYMENT'
          : 'ACTIVE';

    const source: MemberSource =
      scenario === 'PENDING_VERIFICATION'
        ? 'QR_EXISTING'
        : scenario === 'PENDING_PAYMENT'
          ? 'WEBSITE'
          : row.joinedYear >= yearOf(T)
            ? rng.pick(['WEBSITE', 'WALK_IN', 'QR_NEW'] as const)
            : 'WALK_IN';

    const registeredOn = addDays(T, -rng.int(1, 3));
    const createdAt =
      periods[0] !== undefined ? at(periods[0].start, 10 * 60) : at(registeredOn, rng.int(9 * 60, 12 * 60));

    let leftAt: ISTDate | null = null;
    let leftReason: LeftReason | null = null;
    let unsubscribedAt: Date | null = null;
    if (scenario === 'LEFT_UNSUBSCRIBED' && latestEnd !== null) {
      const unsubOn = addDays(latestEnd, rng.int(1, 3)) >= T ? addDays(T, -1) : addDays(latestEnd, rng.int(1, 3));
      leftAt = unsubOn;
      leftReason = 'WHATSAPP_UNSUBSCRIBE';
      unsubscribedAt = at(unsubOn, rng.int(10 * 60, 20 * 60));
    } else if (scenario === 'LEFT_OWNER' && latestEnd !== null) {
      const candidate = addDays(latestEnd, rng.int(10, 25));
      leftAt = candidate > T ? T : candidate;
      leftReason = rng.pick(LEFT_OWNER_REASONS);
    }

    const faceConsent = scenario === 'MINOR_GUARDIAN_PENDING' ? false : row.faceConsent;

    const member: MemberRow = {
      id: memberId,
      gymId,
      memberCode: null, // assigned below, in order of first membership
      fullName: row.fullName,
      mobile: toE164(row.mobile),
      email: row.email,
      dob: dbDate(dob),
      gender: row.gender,
      language: row.language,
      status,
      source,
      isMinor: isMinorOn(dob, T),
      whatsappOptIn: row.whatsappOptIn,
      faceConsent,
      remindersUnsubscribedAt: unsubscribedAt,
      remindersPausedUntil: scenario === 'PAUSED_REMINDERS' ? dbDate(addDays(T, 10)) : null,
      leftAt: leftAt === null ? null : dbDate(leftAt),
      leftReason,
      notes: row.notes,
      lastAttendanceAt: null,
      createdById: source === 'WALK_IN' ? ctx.receptionId : null,
      createdAt,
    };
    members.push(member);
    built.push({
      row,
      member,
      periods,
      unsubscribedAt,
      pausedFrom: scenario === 'PAUSED_REMINDERS' ? addDays(T, -4) : null,
    });

    // ── Memberships and payments ─────────────────────────────────────────────
    for (const p of periods) {
      memberships.push({
        id: p.id,
        gymId,
        memberId,
        planId: p.planId,
        durationMonths: p.months,
        startDate: dbDate(p.start),
        endDate: dbDate(p.end),
        pricePaise: p.pricePaise,
        discountPaise: 0,
        admissionPaise: 0,
        status: 'CONFIRMED',
        source: p.isFirst ? source : 'CRM',
        isDeclared: false,
        declaredEndDate: null,
        createdById: p.isFirst && source !== 'WALK_IN' ? null : ctx.receptionId,
        confirmedAt: p.paidAt,
        createdAt: p.paidAt,
      });

      const method = rng.weighted([
        ['CASH', 45],
        ['UPI_DIRECT', 35],
        ['RAZORPAY', 15],
        ['CARD_POS', 5],
      ] as const);
      const paymentId = nextId('payment', 'pay');
      payments.push({
        id: paymentId,
        gymId,
        memberId,
        membershipId: p.id,
        amountPaise: p.pricePaise,
        method,
        status: 'PAID',
        receiptNo: null, // numbered below, in payment order, per financial year
        providerOrderId: method === 'RAZORPAY' ? `order_seed_${paymentId}` : null,
        providerPaymentId: method === 'RAZORPAY' ? `pay_seed_${paymentId}` : null,
        providerSignatureOk: method === 'RAZORPAY',
        paidAt: p.paidAt,
        recordedById: method === 'RAZORPAY' ? null : rng.chance(0.7) ? ctx.receptionId : ctx.ownerId,
        createdAt: p.paidAt,
      });
    }

    if (scenario === 'PENDING_PAYMENT') {
      // Registered online, never paid (seed spec §3).
      const plan = planFor(row.gender, months);
      const start = registeredOn;
      const membershipId = nextId('membership', 'ms');
      memberships.push({
        id: membershipId,
        gymId,
        memberId,
        planId: plan.id,
        durationMonths: months,
        startDate: dbDate(start),
        endDate: dbDate(membershipEndDate(start, months)),
        pricePaise: plan.pricePaise,
        discountPaise: 0,
        admissionPaise: 0,
        status: 'PENDING_PAYMENT',
        source: 'WEBSITE',
        isDeclared: false,
        declaredEndDate: null,
        createdById: null,
        confirmedAt: null,
        createdAt,
      });
      const paymentId = nextId('payment', 'pay');
      payments.push({
        id: paymentId,
        gymId,
        memberId,
        membershipId,
        amountPaise: plan.pricePaise,
        method: 'RAZORPAY',
        status: 'CREATED',
        receiptNo: null,
        providerOrderId: `order_seed_${paymentId}`,
        providerPaymentId: null,
        providerSignatureOk: false,
        paidAt: null,
        recordedById: null,
        createdAt,
      });
      addTask({
        memberId,
        leadId: null,
        reason: 'SIGNUP_NOT_PAID',
        status: 'OPEN',
        dueDate: dbDate(addDays(registeredOn, 1)),
        attempts: 0,
        outcome: null,
        note: null,
        doneById: null,
        doneAt: null,
        createdAt: at(addDays(registeredOn, 1), 6 * 60),
      });
    }

    if (scenario === 'PENDING_VERIFICATION') {
      const plan = planFor(row.gender, months);
      const matched = row.notes?.toLowerCase().includes('matches imported') === true;
      const submittedAt = at(registeredOn, rng.int(9 * 60, 19 * 60));
      verifications.push({
        id: `vr_${memberId}`,
        gymId,
        memberId,
        referenceCode: `Q-${4801 + verifications.length}`,
        declaredPlanMonths: months,
        declaredEndDate: dbDate(addDays(T, rng.int(-5, 60))),
        declaredAmountPaise: plan.pricePaise,
        matchedImportMemberId: matched ? (healthyIds[verifications.length] ?? null) : null,
        status: 'PENDING',
        createdAt: submittedAt,
      });
      addTask({
        memberId,
        leadId: null,
        reason: 'VERIFICATION_PENDING',
        status: 'OPEN',
        dueDate: dbDate(registeredOn),
        attempts: 0,
        outcome: null,
        note: null,
        doneById: null,
        doneAt: null,
        createdAt: new Date(submittedAt.getTime() + 2 * 3_600_000),
      });
    }

    // ── Consent ledger ───────────────────────────────────────────────────────
    const consentAt = createdAt;
    const channel = source === 'WEBSITE' ? 'web_signup' : source.startsWith('QR') ? 'qr' : 'crm_desk';
    const consentRows: Array<[ConsentRow['type'], boolean]> = [
      ['TERMS', true],
      ['PRIVACY', true],
      ['WHATSAPP_UPDATES', row.whatsappOptIn],
      ['FACE_ATTENDANCE', faceConsent],
    ];
    for (const [type, granted] of consentRows) {
      consents.push({
        id: nextId('consent', 'cn'),
        gymId,
        memberId,
        type,
        granted,
        noticeVersion: '1.0',
        channel,
        recordedById: channel === 'crm_desk' ? ctx.receptionId : null,
        createdAt: consentAt,
      });
    }
  }

  // ── Member codes, in order of first membership (TRD §5) ────────────────────
  const withHistory = built
    .filter((b) => b.periods[0] !== undefined)
    .sort((a, b) => ((a.periods[0]?.start ?? '') < (b.periods[0]?.start ?? '') ? -1 : 1));
  withHistory.forEach((b, index) => {
    b.member.memberCode = formatMemberCode(index + 1);
  });

  // ── Receipt numbers, sequential per financial year (BR-11.2) ───────────────
  const receiptCounters = new Map<string, number>();
  [...payments]
    .filter((p) => p.status === 'PAID' && p.paidAt !== null)
    .sort((a, b) => (a.paidAt?.getTime() ?? 0) - (b.paidAt?.getTime() ?? 0))
    .forEach((p) => {
      const paidOn = istDateOfInstant(p.paidAt as Date);
      const fy = fyLabel(paidOn);
      const next = (receiptCounters.get(fy) ?? 0) + 1;
      receiptCounters.set(fy, next);
      p.receiptNo = formatReceiptNumber(paidOn, next);
    });

  // ── Fee state today, from the canonical core function (ADR-013) ────────────
  const feeView = (periods: readonly Period[], cutoff?: Date): MembershipForFeeState[] =>
    periods
      .filter((p) => cutoff === undefined || p.paidAt <= cutoff)
      .map((p) => ({ id: p.id, startDate: p.start, endDate: p.end, status: 'CONFIRMED' as const }));

  const feeToday = new Map<string, ReturnType<typeof feeState>>();
  for (const b of built) {
    feeToday.set(b.member.id, feeState(T, feeView(b.periods)));
  }

  // ── Attendance: last 60 days (seed spec §5) ────────────────────────────────
  const personaProbability = { REGULAR: 5.5 / 7, MODERATE: 3.5 / 7, IRREGULAR: 1.5 / 7 } as const;
  const minuteFor = (window: 'MORNING' | 'MIDDAY' | 'EVENING'): number => {
    if (window === 'MORNING') return rng.int(5 * 60 + 30, 9 * 60 + 30);
    if (window === 'MIDDAY') return rng.int(10 * 60, 16 * 60);
    // Evening, with the 18:30-20:00 peak the seed spec asks for.
    return rng.chance(0.6) ? rng.int(18 * 60 + 30, 20 * 60) : rng.int(17 * 60 + 30, 21 * 60 + 30);
  };

  const lastAttendance = new Map<string, Date>();
  const absentLastVisit = new Map<string, ISTDate>();

  for (const b of built) {
    const { row, member, periods } = b;
    if (member.status !== 'ACTIVE') continue;

    const fee = feeToday.get(member.id);
    const expiredDays = fee?.daysLeft !== null && fee?.daysLeft !== undefined ? -fee.daysLeft : 0;
    if (fee?.feeState === 'EXPIRED' && expiredDays > 7) continue;

    const recent = periods.filter((p) => diffDays(p.end, T) >= -70);
    const recentView = feeView(recent);
    const preferred = rng.weighted([
      ['MORNING', 40],
      ['MIDDAY', 15],
      ['EVENING', 45],
    ] as const);
    const faceOk = member.faceConsent && !member.isMinor;
    const absentUntil = row.scenario === 'ABSENT_10' ? addDays(T, -rng.int(10, 20)) : null;
    if (absentUntil !== null) absentLastVisit.set(member.id, absentUntil);

    for (let offset = -59; offset <= 0; offset += 1) {
      const d = addDays(T, offset);
      const forcedToday = row.scenario === 'EXPIRED_BUT_VISITING' && offset === 0;
      const forcedAbsent = absentUntil !== null && d === absentUntil;
      const covered = recent.some((p) => p.start <= d && d <= p.end);

      if (!covered && !forcedToday) continue;
      if (absentUntil !== null && d > absentUntil) continue;

      const sunday = dayOfWeek(d) === 0;
      if (!forcedToday && !forcedAbsent) {
        const probability = personaProbability[row.persona] * (sunday ? 0.5 : 1);
        if (!rng.chance(probability)) continue;
      }

      let minute: number;
      if (forcedToday) {
        if (nowMinute < 5 * 60 + 40) continue;
        minute = Math.max(5 * 60 + 30, nowMinute - rng.int(20, 180));
      } else {
        const window = sunday
          ? 'MORNING'
          : rng.chance(0.8)
            ? preferred
            : rng.weighted([
                ['MORNING', 40],
                ['MIDDAY', 15],
                ['EVENING', 45],
              ] as const);
        minute = minuteFor(window);
      }

      const capturedAt = at(d, minute, rng.int(0, 59));
      if (capturedAt > now) continue;

      const method: AttendanceRow['method'] = faceOk
        ? rng.weighted([
            ['FACE', 80],
            ['MANUAL', 15],
            ['KEYPAD', 5],
          ] as const)
        : rng.weighted([
            ['MANUAL', 75],
            ['KEYPAD', 25],
          ] as const);

      attendance.push({
        id: nextId('attendance', 'att'),
        gymId,
        memberId: member.id,
        kioskDeviceId: method === 'MANUAL' ? null : ctx.kioskId,
        clientEventId: `seed:${member.id}:${d}`,
        method,
        capturedAt,
        attendanceDate: dbDate(d),
        matchScore: method === 'FACE' ? Math.round(rng.normal(0.72, 0.05) * 1000) / 1000 : null,
        feeStateAtCheckIn: feeState(d, recentView).feeState,
        recordedById: method === 'MANUAL' ? ctx.receptionId : null,
        createdAt: capturedAt,
      });

      const previous = lastAttendance.get(member.id);
      if (previous === undefined || capturedAt > previous) {
        lastAttendance.set(member.id, capturedAt);
      }
    }
  }

  for (const b of built) {
    b.member.lastAttendanceAt = lastAttendance.get(b.member.id) ?? null;
  }

  // ── WhatsApp message log ───────────────────────────────────────────────────
  const deliveryStatus = (sentAt: Date): MessageStatus =>
    now.getTime() - sentAt.getTime() < 30 * 60_000
      ? 'SENT'
      : rng.weighted([
          ['READ', 70],
          ['DELIVERED', 20],
          ['SENT', 8],
          ['FAILED', 2],
        ] as const);

  const pushOutbound = (
    base: Omit<
      MessageRow,
      'id' | 'gymId' | 'direction' | 'status' | 'providerMessageId' | 'errorCode' | 'errorMessage' | 'sentAt' | 'deliveredAt' | 'readAt' | 'fromNumber' | 'createdAt'
    >,
    scheduledAt: Date,
  ): MessageRow => {
    const sentAt = new Date(scheduledAt.getTime() + rng.int(20, 360) * 1000);
    const status = deliveryStatus(sentAt);
    const id = nextId('message', 'msg');
    const deliveredAt =
      status === 'DELIVERED' || status === 'READ' ? new Date(sentAt.getTime() + rng.int(5, 300) * 1000) : null;
    const readAt =
      status === 'READ' && deliveredAt !== null
        ? new Date(Math.min(now.getTime(), deliveredAt.getTime() + rng.int(60, 6 * 3600) * 1000))
        : null;
    const message: MessageRow = {
      id,
      gymId,
      direction: 'OUTBOUND',
      fromNumber: null,
      ...base,
      providerMessageId: `wamid.seed.${id}`,
      status,
      errorCode: status === 'FAILED' ? '131026' : null,
      errorMessage: status === 'FAILED' ? 'Message undeliverable' : null,
      sentAt,
      deliveredAt,
      readAt,
      createdAt: scheduledAt,
    };
    messages.push(message);
    return message;
  };

  const deliveredReminder = new Set<string>();

  // Reminders, evaluated exactly as the engine will: at each slot, against the
  // memberships that had been paid for by then (ADR-002). Renewals and unsubscribes
  // therefore stop the history at the right moment on their own.
  for (const b of built) {
    const { member, periods } = b;
    const eligibleStatus = member.status === 'ACTIVE' || b.row.scenario === 'LEFT_UNSUBSCRIBED';
    if (!eligibleStatus || !member.whatsappOptIn) continue;

    const recent = periods.filter((p) => diffDays(p.end, T) >= -60).sort((a, c) => (a.end < c.end ? -1 : 1));
    if (recent.length === 0) continue;

    for (let offset = -44; offset <= 0; offset += 1) {
      const d = addDays(T, offset);
      if (b.pausedFrom !== null && d >= b.pausedFrom) continue;

      for (const slot of REMINDER_SLOTS) {
        const slotAt = slotToUtc(d, istTime(slot));
        if (slotAt > now) continue;
        if (b.unsubscribedAt !== null && slotAt >= b.unsubscribedAt) continue;

        const known = recent.filter((p) => p.paidAt <= slotAt);
        const target = known[known.length - 1];
        if (target === undefined) continue;

        const rule = matchingRules(reminderRules, d, target.end, slot)[0];
        if (rule === undefined) continue;

        const message = pushOutbound(
          {
            memberId: member.id,
            membershipId: target.id,
            purpose: 'REMINDER',
            ruleCode: rule.code,
            templateName: rule.templateName,
            language: member.language,
            toNumber: member.mobile,
            idempotencyKey: reminderIdempotencyKey({
              memberId: member.id,
              membershipId: target.id,
              ruleCode: rule.code,
              date: d,
              slot,
            }),
            bodyPreview: null,
            payload: {
              variables: { firstName: firstName(member.fullName), endDate: displayDate(target.end) },
            },
            scheduledFor: slotAt,
          },
          slotAt,
        );
        if (message.status === 'READ' || message.status === 'DELIVERED') {
          deliveredReminder.add(`${member.id}:${target.id}`);
        }
      }
    }
  }

  // Receipts for the 30 most recent payments, and welcomes for the 10 newest members.
  const paidByRecency = payments
    .filter((p) => p.status === 'PAID' && p.paidAt !== null && p.paidAt <= now)
    .sort((a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0));
  const memberById = new Map(members.map((m) => [m.id, m]));

  for (const p of paidByRecency.slice(0, 30)) {
    const member = memberById.get(p.memberId);
    if (member === undefined || p.paidAt === null) continue;
    pushOutbound(
      {
        memberId: member.id,
        membershipId: p.membershipId,
        purpose: 'RECEIPT',
        ruleCode: null,
        templateName: 'mf_payment_receipt',
        language: member.language,
        toNumber: member.mobile,
        idempotencyKey: `receipt:${p.id}`,
        bodyPreview: null,
        payload: { variables: { firstName: firstName(member.fullName), receiptNo: p.receiptNo } },
        scheduledFor: null,
      },
      new Date(p.paidAt.getTime() + 60_000),
    );
  }

  const newest = [...built]
    .filter((b) => b.periods[0] !== undefined && b.member.status === 'ACTIVE')
    .sort((a, b) => ((b.periods[0]?.paidAt.getTime() ?? 0) - (a.periods[0]?.paidAt.getTime() ?? 0)))
    .slice(0, 10);
  for (const b of newest) {
    const first = b.periods[0];
    if (first === undefined) continue;
    pushOutbound(
      {
        memberId: b.member.id,
        membershipId: first.id,
        purpose: 'WELCOME',
        ruleCode: null,
        templateName: 'mf_welcome_member',
        language: b.member.language,
        toNumber: b.member.mobile,
        idempotencyKey: `welcome:${b.member.id}`,
        bodyPreview: null,
        payload: { variables: { firstName: firstName(b.member.fullName) } },
        scheduledFor: null,
      },
      new Date(first.paidAt.getTime() + 2 * 60_000),
    );
  }

  // Seven past verification approvals (seed spec §7).
  healthyIds.slice(10, 17).forEach((id, index) => {
    const member = memberById.get(id);
    if (member === undefined) return;
    pushOutbound(
      {
        memberId: member.id,
        membershipId: null,
        purpose: 'VERIFICATION',
        ruleCode: null,
        templateName: 'mf_verification_approved',
        language: member.language,
        toNumber: member.mobile,
        idempotencyKey: `verification:${member.id}`,
        bodyPreview: null,
        payload: { variables: { firstName: firstName(member.fullName) } },
        scheduledFor: null,
      },
      at(addDays(T, -(5 + index * 3)), 12 * 60),
    );
  });

  // Twenty owner digests, one each morning at 08:30 (crm-module-spec §4).
  for (let day = 1; day <= 20; day += 1) {
    const d = addDays(T, -day);
    pushOutbound(
      {
        memberId: null,
        membershipId: null,
        purpose: 'OWNER_DIGEST',
        ruleCode: null,
        templateName: 'mf_owner_daily_digest',
        language: 'hi',
        toNumber: ctx.ownerMobile,
        idempotencyKey: `digest:${d}`,
        bodyPreview: null,
        payload: null,
        scheduledFor: at(d, 8 * 60 + 30),
      },
      at(d, 8 * 60 + 30),
    );
  }

  // Unsubscribes: the inbound button tap, then the confirmation (BR-6.1-6.3).
  for (const b of built.filter((x) => x.unsubscribedAt !== null)) {
    const tapAt = b.unsubscribedAt as Date;
    messages.push({
      id: nextId('message', 'msg'),
      gymId,
      memberId: b.member.id,
      membershipId: b.periods[b.periods.length - 1]?.id ?? null,
      direction: 'INBOUND',
      purpose: 'OTHER',
      ruleCode: null,
      templateName: null,
      language: b.member.language,
      toNumber: null,
      fromNumber: b.member.mobile,
      idempotencyKey: null,
      providerMessageId: `wamid.seed.in.${b.member.id}`,
      status: 'DELIVERED',
      bodyPreview: null,
      // The real payload carries a signed token; it is never stored in a log.
      payload: { type: 'button', payload: 'UNSUB.[redacted]' },
      errorCode: null,
      errorMessage: null,
      scheduledFor: null,
      sentAt: null,
      deliveredAt: tapAt,
      readAt: null,
      createdAt: tapAt,
    });
    pushOutbound(
      {
        memberId: b.member.id,
        membershipId: null,
        purpose: 'UNSUBSCRIBE_CONFIRM',
        ruleCode: null,
        templateName: null,
        language: b.member.language,
        toNumber: b.member.mobile,
        idempotencyKey: `unsub-confirm:${b.member.id}`,
        bodyPreview: null,
        payload: null,
        scheduledFor: null,
      },
      new Date(tapAt.getTime() + 20_000),
    );
  }

  // ── Call tasks per scenario (BR-7) ─────────────────────────────────────────
  const openTask = (
    memberId: string,
    reason: CallTaskReason,
    dueDate: ISTDate,
    extra: Partial<Pick<CallTaskRow, 'attempts' | 'note'>> = {},
  ): void =>
    addTask({
      memberId,
      leadId: null,
      reason,
      status: 'OPEN',
      dueDate: dbDate(dueDate > T ? T : dueDate),
      attempts: extra.attempts ?? 0,
      outcome: null,
      note: extra.note ?? null,
      doneById: null,
      doneAt: null,
      createdAt: at(dueDate > T ? T : dueDate, 6 * 60),
    });

  for (const b of built) {
    const fee = feeToday.get(b.member.id);
    const end = fee?.effectiveEndDate ?? null;
    const scenario = b.row.scenario;
    if (end === null) continue;

    if (scenario === 'EXPIRED_1_3' && diffDays(T, end) === 3) openTask(b.member.id, 'EXPIRED_NOT_RENEWED', T);
    if (scenario === 'EXPIRED_4_7') openTask(b.member.id, 'EXPIRED_NOT_RENEWED', addDays(end, 3));
    if (scenario === 'EXPIRED_8_40') {
      openTask(b.member.id, 'EXPIRED_NOT_RENEWED', addDays(end, 8), { attempts: rng.int(0, 2) });
    }
    if (scenario === 'EXPIRED_BUT_VISITING') {
      openTask(b.member.id, 'EXPIRED_BUT_VISITING', T);
      if (diffDays(T, end) >= 3) openTask(b.member.id, 'EXPIRED_NOT_RENEWED', addDays(end, 3));
    }
    if (scenario === 'DUE_1') {
      const target = b.periods[b.periods.length - 1];
      if (target !== undefined && deliveredReminder.has(`${b.member.id}:${target.id}`)) {
        openTask(b.member.id, 'DUE_SOON_NO_RESPONSE', T);
      }
    }
    if (scenario === 'ABSENT_10') {
      const last = absentLastVisit.get(b.member.id);
      if (last !== undefined) openTask(b.member.id, 'ABSENT_7_DAYS', addDays(last, 7));
    }
    if (scenario === 'LEFT_UNSUBSCRIBED' && b.member.leftAt !== null) {
      const unsubOn = istDateOfInstant(b.member.leftAt);
      if (rng.chance(0.5)) {
        openTask(b.member.id, 'UNSUBSCRIBED', unsubOn);
      } else {
        addTask({
          memberId: b.member.id,
          leadId: null,
          reason: 'UNSUBSCRIBED',
          status: 'DONE',
          dueDate: dbDate(unsubOn),
          attempts: 1,
          outcome: 'DONE',
          note: 'Asked why — moving to a gym nearer office',
          doneById: ctx.ownerId,
          doneAt: at(addDays(unsubOn, 1), 11 * 60),
          createdAt: at(unsubOn, 21 * 60),
        });
      }
    }
  }

  // Ten tasks completed in the past week, with outcomes (seed spec §8).
  healthyIds.slice(20, 30).forEach((memberId, index) => {
    const doneOn = addDays(T, -rng.int(1, 7));
    const noAnswer = index >= 8;
    addTask({
      memberId,
      leadId: null,
      reason: rng.pick(['DUE_SOON_NO_RESPONSE', 'ABSENT_7_DAYS', 'EXPIRED_NOT_RENEWED'] as const),
      status: 'DONE',
      dueDate: dbDate(addDays(doneOn, -1)),
      attempts: noAnswer ? 3 : 1,
      outcome: noAnswer ? 'NO_ANSWER' : index === 7 ? 'WRONG_NUMBER' : 'DONE',
      note: null,
      doneById: rng.chance(0.6) ? ctx.ownerId : ctx.receptionId,
      doneAt: at(doneOn, rng.int(10 * 60, 20 * 60)),
      createdAt: at(addDays(doneOn, -1), 6 * 60),
    });
  });

  // ── Leads (seed spec §6) ───────────────────────────────────────────────────
  const leadStatuses = rng.shuffle<LeadRow['status']>([
    ...Array<LeadRow['status']>(5).fill('NEW'),
    ...Array<LeadRow['status']>(6).fill('CONTACTED'),
    ...Array<LeadRow['status']>(4).fill('TRIAL_BOOKED'),
    ...Array<LeadRow['status']>(3).fill('VISITED'),
    ...Array<LeadRow['status']>(4).fill('CONVERTED'),
    ...Array<LeadRow['status']>(3).fill('LOST'),
  ]);
  const recentJoiners = [...built]
    .filter((b) => b.member.status === 'ACTIVE' && b.periods.length === 1)
    .map((b) => b.member.id);
  const convertTargets = [...recentJoiners, ...healthyIds.slice(-4)];

  const leads: LeadRow[] = LEAD_NAMES.map((name, index) => {
    const status = leadStatuses[index] ?? 'NEW';
    const source = rng.weighted([
      ['GBP', 40],
      ['WEBSITE_HERO', 20],
      ['WEBSITE_OTHER', 10],
      ['INSTAGRAM', 15],
      ['WALK_IN', 15],
    ] as const);
    const daysAgo = status === 'NEW' ? rng.int(0, 2) : rng.int(1, 29);
    let minute = rng.int(7 * 60, 21 * 60);
    if (daysAgo === 0) minute = Math.max(5 * 60, Math.min(minute, nowMinute - 150));
    return {
      id: `lead_${String(index + 1).padStart(3, '0')}`,
      gymId,
      name,
      mobile: `+91900003${String(index + 1).padStart(4, '0')}`,
      goal: rng.pick(LEAD_GOALS),
      source,
      status,
      utm: source.startsWith('WEBSITE') ? { utm_source: 'google', utm_medium: 'organic' } : null,
      followUpAt: status === 'TRIAL_BOOKED' ? at(addDays(T, rng.int(1, 3)), 18 * 60) : null,
      convertedMemberId: null,
      createdAt: at(addDays(T, -daysAgo), minute),
    };
  });
  leads
    .filter((l) => l.status === 'CONVERTED')
    .forEach((lead, index) => {
      lead.convertedMemberId = convertTargets[index] ?? null;
    });
  for (const lead of leads.filter((l) => l.status === 'NEW' && now.getTime() - l.createdAt.getTime() >= 2 * 3_600_000)) {
    addTask({
      memberId: null,
      leadId: lead.id,
      reason: 'NEW_LEAD',
      status: 'OPEN',
      dueDate: dbDate(istDateOfInstant(lead.createdAt)),
      attempts: 0,
      outcome: null,
      note: null,
      doneById: null,
      doneAt: null,
      createdAt: new Date(lead.createdAt.getTime() + 2 * 3_600_000),
    });
  }

  // ── Alerts: six unread across types, a few read (seed spec §8) ─────────────
  const pushAlert = (alert: Omit<AlertRow, 'id' | 'gymId'>): void => {
    alerts.push({ id: nextId('alert', 'al'), gymId, ...alert });
  };
  for (const b of built.filter((x) => x.row.scenario === 'EXPIRED_BUT_VISITING')) {
    const visit = attendance.find((a) => a.memberId === b.member.id && a.attendanceDate.getTime() === dbDate(T).getTime());
    const fee = feeToday.get(b.member.id);
    if (visit === undefined) continue;
    pushAlert({
      type: 'EXPIRED_MEMBER_VISIT',
      memberId: b.member.id,
      title: 'crm.alerts.expiredMemberVisit',
      params: { name: b.member.fullName, daysExpired: fee?.daysLeft === null || fee === undefined ? 0 : -(fee.daysLeft ?? 0) },
      readAt: null,
      createdAt: visit.capturedAt,
    });
  }
  const newestLead = [...leads].filter((l) => l.status === 'NEW').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (newestLead !== undefined) {
    pushAlert({
      type: 'NEW_LEAD',
      memberId: null,
      title: 'crm.alerts.newLead',
      params: { name: newestLead.name, goal: newestLead.goal },
      readAt: null,
      createdAt: newestLead.createdAt,
    });
  }
  const newestVerification = [...verifications].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (newestVerification !== undefined) {
    pushAlert({
      type: 'VERIFICATION_PENDING',
      memberId: newestVerification.memberId,
      title: 'crm.alerts.verificationPending',
      params: { referenceCode: newestVerification.referenceCode },
      readAt: null,
      createdAt: newestVerification.createdAt,
    });
  }
  const latestUnsub = [...built]
    .filter((b) => b.unsubscribedAt !== null)
    .sort((a, b) => (b.unsubscribedAt?.getTime() ?? 0) - (a.unsubscribedAt?.getTime() ?? 0))[0];
  if (latestUnsub !== undefined && latestUnsub.unsubscribedAt !== null) {
    pushAlert({
      type: 'MEMBER_UNSUBSCRIBED',
      memberId: latestUnsub.member.id,
      title: 'crm.alerts.memberUnsubscribed',
      params: { name: latestUnsub.member.fullName },
      readAt: null,
      createdAt: latestUnsub.unsubscribedAt,
    });
  }
  for (const p of paidByRecency.filter((x) => x.method === 'RAZORPAY').slice(0, 3)) {
    const member = memberById.get(p.memberId);
    if (member === undefined || p.paidAt === null) continue;
    pushAlert({
      type: 'ONLINE_PAYMENT',
      memberId: member.id,
      title: 'crm.alerts.onlinePayment',
      params: { name: member.fullName, amountPaise: p.amountPaise },
      readAt: new Date(p.paidAt.getTime() + 3_600_000),
      createdAt: p.paidAt,
    });
  }
  pushAlert({
    type: 'KIOSK_OFFLINE',
    memberId: null,
    title: 'crm.alerts.kioskOffline',
    params: { minutes: 42 },
    readAt: at(addDays(T, -2), 9 * 60),
    createdAt: at(addDays(T, -2), 7 * 60 + 15),
  });

  // ── Counters ───────────────────────────────────────────────────────────────
  const counters: CounterRow[] = [
    { id: 'ctr_member_code', gymId, key: 'member_code', value: withHistory.length },
    ...[...receiptCounters.entries()].map(([fy, value]) => ({
      id: `ctr_receipt_${fy}`,
      gymId,
      key: `receipt:${fy}`,
      value,
    })),
  ];

  // ── Summary ────────────────────────────────────────────────────────────────
  const membersByStatus: Record<string, number> = {};
  for (const m of members) membersByStatus[m.status] = (membersByStatus[m.status] ?? 0) + 1;

  const feeStates = Object.fromEntries(FEE_STATES.map((s) => [s, 0])) as Record<FeeState, number>;
  for (const m of members.filter((x) => x.status === 'ACTIVE')) {
    const state = feeToday.get(m.id)?.feeState ?? 'NONE';
    feeStates[state] += 1;
  }

  const candidates = built.map((b) => ({
    dob: istDateOfInstant(b.member.dob as Date),
    status: b.member.status,
  }));

  const openCallTasksByReason: Record<string, number> = {};
  for (const t of callTasks.filter((x) => x.status === 'OPEN')) {
    openCallTasksByReason[t.reason] = (openCallTasksByReason[t.reason] ?? 0) + 1;
  }

  const monthPrefix = T.slice(0, 7);
  const paidThisMonth = payments.filter(
    (p) => p.status === 'PAID' && p.paidAt !== null && istDateOfInstant(p.paidAt).slice(0, 7) === monthPrefix,
  );

  const summary: SeedSummary = {
    membersByStatus,
    feeStates,
    birthdaysToday: candidates.filter((c) => hasBirthdayToday(c, T)).length,
    birthdaysThisWeek: candidates.filter((c) => hasBirthdayWithin(c, T, 6)).length,
    openCallTasks: callTasks.filter((t) => t.status === 'OPEN').length,
    openCallTasksByReason,
    collectionsThisMonthPaise: paidThisMonth.reduce((sum, p) => sum + p.amountPaise, 0),
    paymentsThisMonth: paidThisMonth.length,
    attendanceToday: attendance.filter((a) => a.attendanceDate.getTime() === dbDate(T).getTime()).length,
    unreadAlerts: alerts.filter((a) => a.readAt === null).length,
  };

  return {
    members,
    memberships,
    payments,
    consents,
    attendance,
    verifications,
    leads,
    messages,
    callTasks,
    alerts,
    counters,
    summary,
  };
}

/** The IST calendar date of an instant, or of a `@db.Date` value (midnight UTC). */
function istDateOfInstant(value: Date): ISTDate {
  // @db.Date values are built as midnight UTC; reading them in IST would shift nothing
  // (05:30 the same day), and real instants map to their IST day as expected.
  return slotDate(value);
}

function slotDate(value: Date): ISTDate {
  const ist = new Date(value.getTime() + 5.5 * 3_600_000);
  return istDateOf(ist.getUTCFullYear(), ist.getUTCMonth() + 1, ist.getUTCDate());
}

/**
 * Date of birth. The CSV only holds the year (seed spec §3), so the builder picks
 * the month and day — deterministically — and keeps accidental birthdays out of the
 * next seven days so the BIRTHDAY_TODAY and BIRTHDAY_WEEK tiles show exactly their
 * scenario's members.
 */
function dobFor(row: DemoMemberRow, T: ISTDate, rng: Rng): ISTDate {
  switch (row.scenario) {
    case 'BIRTHDAY_TODAY':
      return safeDate(row.dobYear, monthOf(T), dayOf(T));
    case 'BIRTHDAY_WEEK': {
      const target = addDays(T, rng.int(1, 6));
      return safeDate(row.dobYear, monthOf(target), dayOf(target));
    }
    case 'MINOR_GUARDIAN_PENDING': {
      // Aged 16-17 on today's date, with the birthday comfortably behind them.
      const age = rng.pick([16, 17] as const);
      return addDays(addMonthsClamped(T, -age * 12), -rng.int(1, 300));
    }
    default: {
      let candidate = safeDate(row.dobYear, rng.int(1, 12), rng.int(1, 28));
      for (let attempt = 0; attempt < 12; attempt += 1) {
        if (daysUntilBirthday(candidate, T, 6) === null) return candidate;
        candidate = safeDate(row.dobYear, rng.int(1, 12), rng.int(1, 28));
      }
      // Fall back to a date half a year away from today.
      return safeDate(row.dobYear, ((monthOf(T) + 5) % 12) + 1, 15);
    }
  }
}
