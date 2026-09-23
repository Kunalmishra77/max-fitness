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

/** `M3_FEMALE` and friends — the `Plan.code` format (database-design.md §2). */
export type PlanCode = `M${PlanDurationMonths}_${PricedGender}`;

export function planCode(months: PlanDurationMonths, gender: PricedGender): PlanCode {
  return `M${months}_${gender}`;
}

export const PLAN_CODES: readonly PlanCode[] = PRICED_GENDERS.flatMap((g) =>
  PLAN_DURATIONS.map((m) => planCode(m, g)),
);

/** Default prices in paise (BR-2.2). The 3/6/12-month rows are placeholders pending owner sign-off. */
export const DEFAULT_PLAN_PRICES_PAISE: Readonly<Record<PlanCode, number>> = {
  M1_MALE: 150_000,
  M3_MALE: 400_000,
  M6_MALE: 750_000,
  M12_MALE: 1_350_000,
  M1_FEMALE: 120_000,
  M3_FEMALE: 320_000,
  M6_FEMALE: 600_000,
  M12_FEMALE: 1_080_000,
};

// ── Reminder rules (BR-5.1) ───────────────────────────────────────────────────
export const REMINDER_RULE_CODES = ['PRE_7', 'PRE_3', 'PRE_2', 'PRE_1', 'DUE_TODAY', 'POST'] as const;
export type ReminderRuleCode = (typeof REMINDER_RULE_CODES)[number];

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
} as const;
export type WhatsAppTemplateName = (typeof WHATSAPP_TEMPLATES)[keyof typeof WHATSAPP_TEMPLATES];

export interface ReminderRuleDefault {
  readonly code: ReminderRuleCode;
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
    slots: ['09:30', '14:00', '19:00'],
    templateName: 'mf_membership_expired',
  },
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
export const TOKEN_PURPOSES = ['renew', 'receipt', 'unsub', 'restart', 'registration', 'otp'] as const;
export type TokenPurpose = (typeof TOKEN_PURPOSES)[number];

/** Receipt number format: `MF/2026-27/000123` (BR-11.2). */
export const RECEIPT_PREFIX = 'MF';
export const RECEIPT_SEQUENCE_DIGITS = 6;

/** Member code format: `MF-0231` (TRD §5). */
export const MEMBER_CODE_PREFIX = 'MF-';
export const MEMBER_CODE_DIGITS = 4;

/** The worker is considered dead when its last heartbeat is older than this (ADR-018). */
export const WORKER_HEARTBEAT_STALE_SECONDS = 180;
