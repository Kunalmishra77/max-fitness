/**
 * Enumerations shared by the database, the domain rules and the UI.
 *
 * These mirror the Prisma enums in `packages/db/prisma/schema.prisma`. Where a value
 * exists in both places the two must agree; the types here are what non-database code
 * imports, so `packages/core` never has to depend on Prisma.
 */

// ── Fee state (BR-4.2) — derived, never stored ────────────────────────────────
export const FEE_STATES = ['PAID', 'DUE_SOON', 'EXPIRED', 'NONE'] as const;
export type FeeState = (typeof FEE_STATES)[number];

/** Days-left boundary between PAID and DUE_SOON (BR-4.2). */
export const DUE_SOON_DAYS = 7;

/** Token names for the fee-state colours in design-tokens.json. */
export const FEE_STATE_TOKENS: Readonly<Record<FeeState, { fg: string; bg: string }>> = {
  PAID: { fg: '--color-fee-paid', bg: '--color-fee-paid-bg' },
  DUE_SOON: { fg: '--color-fee-due-soon', bg: '--color-fee-due-soon-bg' },
  EXPIRED: { fg: '--color-fee-expired', bg: '--color-fee-expired-bg' },
  NONE: { fg: '--color-fee-none', bg: '--color-fee-none-bg' },
};

// ── Plans (BR-2.1) ────────────────────────────────────────────────────────────
export const PLAN_DURATIONS = [1, 3, 6, 12] as const;
export type PlanDurationMonths = (typeof PLAN_DURATIONS)[number];

export const PRICED_GENDERS = ['MALE', 'FEMALE'] as const;
export type PricedGender = (typeof PRICED_GENDERS)[number];

export const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
export type Gender = (typeof GENDERS)[number];

/**
 * What a plan row sells. A gym membership, or personal training alongside one —
 * priced separately, bought separately, and never a substitute for the membership (ADR-087).
 */
export const PLAN_KINDS = ['MEMBERSHIP', 'PT'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

/** `M3_FEMALE` and friends — the `Plan.code` format (database-design.md §2). */
export type MembershipPlanCode = `M${PlanDurationMonths}_${PricedGender}`;
/** `PT3_FEMALE` — personal training, same shape so one table holds both (ADR-087). */
export type PtPlanCode = `PT${PlanDurationMonths}_${PricedGender}`;
export type PlanCode = MembershipPlanCode | PtPlanCode;

export function planCode(months: PlanDurationMonths, gender: PricedGender): MembershipPlanCode {
  return `M${months}_${gender}`;
}

export function ptPlanCode(months: PlanDurationMonths, gender: PricedGender): PtPlanCode {
  return `PT${months}_${gender}`;
}

export const PLAN_CODES: readonly MembershipPlanCode[] = PRICED_GENDERS.flatMap((g) =>
  PLAN_DURATIONS.map((m) => planCode(m, g)),
);

export const PT_PLAN_CODES: readonly PtPlanCode[] = PRICED_GENDERS.flatMap((g) =>
  PLAN_DURATIONS.map((m) => ptPlanCode(m, g)),
);

export function planKindOfCode(code: string): PlanKind {
  return code.startsWith('PT') ? 'PT' : 'MEMBERSHIP';
}

/** Default prices in paise (BR-2.2). The 3/6/12-month rows are placeholders pending owner sign-off. */
export const DEFAULT_PLAN_PRICES_PAISE: Readonly<Record<MembershipPlanCode, number>> = {
  M1_MALE: 150_000,
  M3_MALE: 400_000,
  M6_MALE: 750_000,
  M12_MALE: 1_350_000,
  M1_FEMALE: 120_000,
  M3_FEMALE: 320_000,
  M6_FEMALE: 600_000,
  M12_FEMALE: 1_080_000,
};

/**
 * Personal training, as the gym quoted it in October 2026: the same price for men and
 * women, and the longer you take the less each month costs (ADR-087).
 *
 * Stored as the **total** for the whole term — ₹4,500 × 3 is ₹13,500 — because that is
 * what the member pays and what the receipt must add up to. The per-month figure the
 * price list shows is derived from it, never the other way round, so the two cannot drift.
 */
export const DEFAULT_PT_PRICES_PAISE: Readonly<Record<PlanDurationMonths, number>> = {
  1: 500_000,
  3: 1_350_000,
  6: 2_400_000,
  12: 3_600_000,
};

// ── Reminder rules (BR-5.1) ───────────────────────────────────────────────────
export const REMINDER_RULE_CODES = [
  'PRE_7',
  'PRE_3',
  'PRE_2',
  'PRE_1',
  'DUE_TODAY',
  'POST',
  // The trial's own follow-ups (ADR-088). A three-day trial must never be told to renew.
  'TRIAL_MID',
  'TRIAL_LAST',
  'TRIAL_AFTER',
] as const;
export type ReminderRuleCode = (typeof REMINDER_RULE_CODES)[number];

/**
 * Which kind of membership a reminder rule is about (ADR-088).
 *
 * The rules all fire off a membership's end date, and a trial is a membership — so
 * without this a trial member would get "your fees run out today" on day three.
 */
export const REMINDER_APPLIES_TO = ['MEMBERSHIP', 'TRIAL'] as const;
export type ReminderAppliesTo = (typeof REMINDER_APPLIES_TO)[number];

export const WHATSAPP_TEMPLATES = {
  renewalDue: 'mf_renewal_due',
  renewalDueToday: 'mf_renewal_due_today',
  membershipExpired: 'mf_membership_expired',
  paymentReceipt: 'mf_payment_receipt',
  loginCode: 'mf_login_code',
  welcomeMember: 'mf_welcome_member',
  verificationApproved: 'mf_verification_approved',
  ownerDigest: 'mf_owner_daily_digest',
  ownerAlert: 'mf_owner_alert',
  birthdayWish: 'mf_birthday_wish',
  announcement: 'mf_announcement',
  // The trial, start to finish (ADR-088).
  // The diet plan (ADR-089): one template asks every question, one delivers the plan.
  dietQuestion: 'mf_diet_question',
  dietPlanReady: 'mf_diet_plan_ready',
  dietFollowUp: 'mf_diet_follow_up',
  trialWelcome: 'mf_trial_welcome',
  trialCheckIn: 'mf_trial_check_in',
  trialLastDay: 'mf_trial_last_day',
  trialJoin: 'mf_trial_join',
  // Autopay (ADR-105). The first carries the authorisation link; the second is the one that
  // matters most, because a halted mandate looks exactly like a paid-up member until asked.
  mandateInvite: 'mf_autopay_invite',
  mandateHalted: 'mf_autopay_halted',
  mandateCancelled: 'mf_autopay_cancelled',
} as const;
export type WhatsAppTemplateName = (typeof WHATSAPP_TEMPLATES)[keyof typeof WHATSAPP_TEMPLATES];

export interface ReminderRuleDefault {
  readonly code: ReminderRuleCode;
  /** Memberships unless it says otherwise, which is what every pre-trial rule meant. */
  readonly appliesTo?: ReminderAppliesTo;
  /** Days relative to `endDate`; negative is before. For POST this is the first day (+1). */
  readonly offsetDays: number;
  /** Last offset for a range rule; equals `offsetDays` for single-day rules. `null` = no cap. */
  readonly offsetDaysTo: number | null;
  readonly slots: readonly string[];
  readonly templateName: WhatsAppTemplateName;
}

/** The BR-5.1 default schedule, seeded into `ReminderRule`. */
export const DEFAULT_REMINDER_RULES: readonly ReminderRuleDefault[] = [
  { code: 'PRE_7', offsetDays: -7, offsetDaysTo: -7, slots: ['10:00'], templateName: 'mf_renewal_due' },
  { code: 'PRE_3', offsetDays: -3, offsetDaysTo: -3, slots: ['10:00'], templateName: 'mf_renewal_due' },
  { code: 'PRE_2', offsetDays: -2, offsetDaysTo: -2, slots: ['10:00'], templateName: 'mf_renewal_due' },
  { code: 'PRE_1', offsetDays: -1, offsetDaysTo: -1, slots: ['10:00'], templateName: 'mf_renewal_due' },
  { code: 'DUE_TODAY', offsetDays: 0, offsetDaysTo: 0, slots: ['10:00'], templateName: 'mf_renewal_due_today' },
  {
    code: 'POST',
    offsetDays: 1,
    // Seeded from settings.postExpiryMaxDays; offsetDaysTo is authoritative (ADR-015).
    offsetDaysTo: 7,
    // ADR-068: once a day, in the evening. Three a day for seven days is 21 messages
    // to one person whose fee ran out, which costs the gym its WhatsApp quality.
    slots: ['19:00'],
    templateName: 'mf_membership_expired',
  },
  /**
   * The trial's three follow-ups (ADR-088), all off its own end date.
   *
   * `TRIAL_MID` lands the day before the last one, so a one-day trial never gets it —
   * its offset falls before the trial began, and the candidate query finds nobody.
   * `TRIAL_AFTER` waits two days, so "would you like to join?" is not asked in the same
   * breath as "today is your last day".
   */
  { code: 'TRIAL_MID', appliesTo: 'TRIAL', offsetDays: -1, offsetDaysTo: -1, slots: ['19:00'], templateName: 'mf_trial_check_in' },
  { code: 'TRIAL_LAST', appliesTo: 'TRIAL', offsetDays: 0, offsetDaysTo: 0, slots: ['19:00'], templateName: 'mf_trial_last_day' },
  { code: 'TRIAL_AFTER', appliesTo: 'TRIAL', offsetDays: 2, offsetDaysTo: 2, slots: ['10:00'], templateName: 'mf_trial_join' },
];

/** Every distinct slot the worker must schedule a cron for. */
export const ALL_REMINDER_SLOTS: readonly string[] = [
  ...new Set(DEFAULT_REMINDER_RULES.flatMap((r) => r.slots)),
].sort();

// ── Member lifecycle (BR-4.1) ─────────────────────────────────────────────────
export const MEMBER_STATUSES = [
  'PENDING_PAYMENT',
  'PENDING_VERIFICATION',
  'ACTIVE',
  'LEFT',
  'BLOCKED',
] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/**
 * Which half of the day a member trains in. The gym opens 4:30–12:00 and again
 * 17:00–22:00, so "when do you come?" is a real question the desk asks (ADR-085).
 */
export const TRAINING_SLOTS = ['MORNING', 'EVENING', 'BOTH'] as const;
export type TrainingSlot = (typeof TRAINING_SLOTS)[number];

export function isTrainingSlot(value: unknown): value is TrainingSlot {
  return typeof value === 'string' && (TRAINING_SLOTS as readonly string[]).includes(value);
}

// ── Call tasks (BR-7) ─────────────────────────────────────────────────────────
export const CALL_TASK_REASONS = [
  'EXPIRED_BUT_VISITING',
  'SIGNUP_NOT_PAID',
  'NEW_LEAD',
  'VERIFICATION_PENDING',
  'EXPIRED_NOT_RENEWED',
  'DUE_SOON_NO_RESPONSE',
  'ABSENT_7_DAYS',
  'UNSUBSCRIBED',
  'OTHER',
] as const;
export type CallTaskReason = (typeof CALL_TASK_REASONS)[number];

/** Priority per BR-7; 1 is highest and sorts to the top of the owner's list. */
export const CALL_TASK_PRIORITY: Readonly<Record<CallTaskReason, number>> = {
  EXPIRED_BUT_VISITING: 1,
  SIGNUP_NOT_PAID: 2,
  NEW_LEAD: 2,
  VERIFICATION_PENDING: 2,
  EXPIRED_NOT_RENEWED: 3,
  DUE_SOON_NO_RESPONSE: 4,
  ABSENT_7_DAYS: 5,
  UNSUBSCRIBED: 6,
  OTHER: 7,
};

// ── Misc ──────────────────────────────────────────────────────────────────────
export const LANGUAGES = ['hi', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Purposes a signed link may carry. Tokens are bound to one (security-plan.md §3.1). */
export const TOKEN_PURPOSES = ['renew', 'receipt', 'unsub', 'restart', 'registration', 'otp', 'diet'] as const;
export type TokenPurpose = (typeof TOKEN_PURPOSES)[number];

/** Receipt number format: `MF/2026-27/000123` (BR-11.2). */
export const RECEIPT_PREFIX = 'MF';
export const RECEIPT_SEQUENCE_DIGITS = 6;

/** Member code format: `MF-0231` (TRD §5). */
export const MEMBER_CODE_PREFIX = 'MF-';
export const MEMBER_CODE_DIGITS = 4;

/** The worker is considered dead when its last heartbeat is older than this (ADR-018). */
export const WORKER_HEARTBEAT_STALE_SECONDS = 180;
