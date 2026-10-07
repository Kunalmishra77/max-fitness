import { z } from 'zod';
import { minutesOfDay, istTime, isISTTime } from '../time/ist-date';

/**
 * `Gym.settings` — every value marked ⚙ in business-rules.md.
 *
 * The owner edits these from the CRM, so the schema is the contract between the
 * settings screen, the rules engine and the seed. Defaults come straight from the
 * business rules; where a rule is a placeholder pending owner sign-off it says so.
 */

const hhmm = z
  .string()
  .refine(isISTTime, { message: 'Expected a time of day as HH:mm (00:00-23:59)' })
  .transform((v) => istTime(v));

export const QuietHoursSchema = z
  .object({
    /** No automated message before this IST time (BR-5.3 rule 5). Default 08:00. */
    start: hhmm.prefault('08:00'),
    /** No automated message after this IST time. Default 21:00. */
    end: hhmm.prefault('21:00'),
  })
  .refine((v) => minutesOfDay(v.start) < minutesOfDay(v.end), {
    message: 'Quiet hours must start before they end; an overnight window is not supported',
  });
export type QuietHours = z.infer<typeof QuietHoursSchema>;

export const GymHoursSchema = z.object({
  /** 0 = Sunday. */
  day: z.number().int().min(0).max(6),
  open: hhmm,
  close: hhmm,
  closed: z.boolean().default(false),
});
export type GymHours = z.infer<typeof GymHoursSchema>;

export const FeatureFlagsSchema = z.object({
  /** Require OTP before a QR/existing submission (TRD §5). Off for launch. */
  otpRequired: z.boolean().default(false),
  /** Send birthday wishes without the owner tapping Send (BR-8.2). Off by default. */
  autoBirthdayWish: z.boolean().default(false),
  /** Kiosk records matches but never greets, for accuracy tuning before go-live. */
  kioskShadowMode: z.boolean().default(true),
  /** One "complete your payment" nudge to PENDING_PAYMENT members (BR-4.1). Off by default. */
  signupPaymentNudge: z.boolean().default(false),
  /** Store a snapshot frame with each kiosk check-in. Off: it is extra biometric data. */
  kioskCheckInSnapshots: z.boolean().default(false),
});
export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>;

export const TrustNumbersSchema = z.object({
  googleRating: z.number().min(0).max(5).default(4.8),
  googleReviews: z.number().int().nonnegative().default(231),
  justdialRating: z.number().min(0).max(5).default(4.9),
  justdialReviews: z.number().int().nonnegative().default(262),
  establishedYear: z.number().int().min(1900).max(2100).default(2000),
});
export type TrustNumbers = z.infer<typeof TrustNumbersSchema>;

export const PromoSchema = z.object({
  /** Mid-page promo banner (PRD LP-11): the owner's current offer. */
  enabled: z.boolean().default(false),
  textEn: z.string().max(120).default(''),
  textHi: z.string().max(120).default(''),
  /**
   * Announcement bar above the navigation (PRD LP-02). A separate, shorter line —
   * the copy deck gives it different text ("First session free…") from the banner.
   * Off by default so existing settings keep their current behaviour (ADR-024).
   */
  barEnabled: z.boolean().default(false),
  barTextEn: z.string().max(90).default(''),
  barTextHi: z.string().max(90).default(''),
  /** `YYYY-MM-DD`; the banner hides itself outside the window. */
  startDate: z.string().nullable().default(null),
  endDate: z.string().nullable().default(null),
});
export type Promo = z.infer<typeof PromoSchema>;

export const PricingSettingsSchema = z.object({
  /** BR-2.6. Added as a separate line on a member's first membership only. */
  admissionFeePaise: z.number().int().nonnegative().default(0),
  /** BR-2.5. `OTHER` sees male prices online with a note that the desk confirms. */
  otherGenderPricing: z.enum(['ASK_AT_DESK', 'MALE_RATE', 'FEMALE_RATE']).default('ASK_AT_DESK'),
  /** BR-2.7. Only staff with permission may discount, and only at the desk. */
  allowDeskDiscounts: z.boolean().default(true),
  /**
   * crm-module-spec §3 "Renew / record payment — Reception ✓ (setting)". Its own switch:
   * it used to be read from `allowDeskDiscounts`, so turning discounts off also stopped
   * reception taking fees (ADR-048).
   */
  receptionMayTakePayments: z.boolean().default(true),
  /** BR-11.1. Partial payments are disabled in 1.0. */
  allowPartialPayments: z.boolean().default(false),
  /**
   * The trial a new member can buy before committing to a month (ADR-088).
   *
   * It is called a free trial because that is what the gym calls it; it costs ₹100 a day.
   * Priced per day rather than as a plan, because the lengths are days and the member
   * picks how many — there is no catalogue row to point at.
   */
  trialEnabled: z.boolean().default(true),
  trialPerDayPaise: z.number().int().positive().max(100_000).default(10_000),
  /** How many days a newcomer may buy, shortest first. */
  trialDayOptions: z.array(z.number().int().positive().max(30)).min(1).max(8).default([1, 2, 3, 5, 7]),
  /**
   * How often a diet plan is checked on, in days (ADR-089). 0 switches follow-ups off.
   *
   * It lives under pricing only because that is where the owner's own switches already are;
   * nothing about it is a price. Thirty days is "once a month" without arithmetic about
   * which month.
   */
  dietFollowUpEveryDays: z.number().int().min(0).max(180).default(30),
});
export type PricingSettings = z.infer<typeof PricingSettingsSchema>;

export const MembershipSettingsSchema = z.object({
  /** BR-3.3. How far ahead an online sign-up may set its start date. */
  maxStartDateDaysAhead: z.number().int().min(0).max(90).default(15),
  /** BR-3.4. Renew within this many days of expiry and the new term still chains on. */
  renewalGraceDays: z.number().int().min(0).max(30).default(5),
  /** BR-4.3. An ACTIVE member expired this long with no payment becomes LEFT. */
  autoLeftAfterDays: z.number().int().min(7).max(365).default(60),
});
export type MembershipSettings = z.infer<typeof MembershipSettingsSchema>;

export const ReminderSettingsSchema = z.object({
  /**
   * The kill switch (whatsapp-automation-engine "Kill switch"; ADR-052): the owner has
   * stopped every automatic message. Checked at send time, before anything else.
   */
  automaticPaused: z.boolean().default(false),
  quietHours: QuietHoursSchema.prefault({ start: '08:00', end: '21:00' }),
  /**
   * BR-5.2. Last day after expiry on which automatic reminders are sent.
   * `null` means no limit, which the settings screen must warn about — an uncapped
   * POST rule keeps messaging people who left, and Meta downgrades number quality.
   * Mirrored onto `ReminderRule.offsetDaysTo`, which is authoritative (ADR-015).
   */
  postExpiryMaxDays: z.number().int().min(1).max(60).nullable().default(7),
  /** BR-6.4. A member may undo an unsubscribe themselves within this window. */
  restartWindowDays: z.number().int().min(1).max(30).default(7),
  /** Cap on automated messages to one WhatsApp number per day (BR-5.6 shared numbers). */
  maxMessagesPerNumberPerDay: z.number().int().min(1).max(20).default(4),
});
export type ReminderSettings = z.infer<typeof ReminderSettingsSchema>;

export const AttendanceSettingsSchema = z.object({
  /** BR-9.1. A second check-in inside this window is ignored, not recorded. */
  checkInCooldownMinutes: z.number().int().min(1).max(1440).default(180),
  /** BR-7 ABSENT_7_DAYS. Days without attendance before a call task is raised. */
  absentDaysThreshold: z.number().int().min(1).max(90).default(7),
  /** Alert the owner when the kiosk has not been seen for this long (crm-module-spec §4). */
  kioskOfflineAlertMinutes: z.number().int().min(5).max(720).default(30),
  /** The kiosk speaks its greeting (api-specification §7 pairing `settings.voice`). */
  kioskVoice: z.boolean().default(true),
  /**
   * Face-match thresholds (attendance spec §6).
   *
   * **No longer placeholders.** They come from running YuNet + SFace over the gym's own
   * selfies (ADR-107): two different members never scored above **0.387** against each
   * other, while a well-enrolled member scored **0.681–0.99** against degraded versions of
   * themselves. 0.55 sits between the two with room on both sides.
   *
   * They stay in settings rather than in code because a bigger gallery has more chances of
   * a close pair, and shadow mode exists to recalibrate them against real traffic before
   * any member is greeted by name. Owner only.
   */
  acceptThreshold: z.number().min(0).max(1).default(0.55),
  /** How far below `acceptThreshold` still asks the member to confirm rather than greeting. */
  confirmBand: z.number().min(0).max(0.5).default(0.12),
  /** The gap the best match needs over the runner-up, so siblings are not confused. */
  matchMargin: z.number().min(0).max(0.5).default(0.1),
  /** Frames that must agree before the kiosk decides anything. */
  framesToAgree: z.number().int().min(1).max(10).default(3),
  /** How many face templates one member may have (1–2 selfie, 3–5 assisted, rest adaptive). */
  maxTemplatesPerMember: z.number().int().min(1).max(20).default(8),

  /**
   * Whether a photograph is good enough to recognise the member by (ADR-107).
   *
   * `enrolmentMinFacePx` is the single number this whole feature rests on. Measured: the
   * two selfies whose faces were 43 px and 129 px fell to 0.59 and 0.42 against themselves
   * — *below* where different people score — while every selfie from 192 px up stayed
   * above 0.84. 180 sits between them with room on both sides.
   *
   * The check-in floor is deliberately far lower: a well-enrolled member still scored 0.98
   * at a third of their enrolment size, so demanding a big face at the desk would only have
   * members leaning into the phone.
   */
  enrolmentMinFacePx: z.number().int().min(60).max(600).default(180),
  checkInMinFacePx: z.number().int().min(20).max(400).default(60),
  /** Below this the detector is not really claiming a face. The gym's selfies ran 0.79–0.95. */
  faceMinConfidence: z.number().min(0).max(1).default(0.7),
  faceMinBrightness: z.number().int().min(0).max(255).default(45),
  faceMaxBrightness: z.number().int().min(0).max(255).default(225),
  /**
   * A floor that catches a smeared photograph — **not** a quality ranking.
   *
   * Sharpness was measured across the gym's selfies and does not separate good enrolments
   * from bad: the two that failed scored 236 and 858, while a member who recognised
   * perfectly scored 130. Used as a score it would reject the wrong people.
   */
  faceMinSharpness: z.number().min(0).max(5000).default(60),
  /**
   * How big a second face must be, next to the main one, to count as another person.
   *
   * Two of the gym's selfies contain a detection a few pixels across — a pattern on a wall.
   * Counting faces would refuse a member because of their wallpaper; comparing them refuses
   * only somebody actually standing there.
   */
  secondFaceRatio: z.number().min(0.1).max(1).default(0.45),
});
export type AttendanceSettings = z.infer<typeof AttendanceSettingsSchema>;

export const PrivacySettingsSchema = z.object({
  /** BR-12.2. Nobody younger may join. */
  minAge: z.number().int().min(12).max(21).default(16),
  /** BR-6.6. Grace period before a LEFT member's face templates are deleted. */
  faceDeleteAfterLeftDays: z.number().int().min(0).max(365).default(30),
  /** database-design.md §7. Check-in snapshots, when enabled at all. */
  checkInSnapshotRetentionDays: z.number().int().min(1).max(90).default(7),
  /** BR-12.3. Bump this and members re-accept at their next kiosk visit or renewal. */
  privacyNoticeVersion: z.string().min(1).default('1.0'),
});
export type PrivacySettings = z.infer<typeof PrivacySettingsSchema>;

// Zod 4: `.default(x)` returns x as-is without parsing it, so `.default({})` would
// yield an empty group with none of its field defaults. `.prefault(x)` parses x
// through the schema, which is what fills in every nested default.
export const GymSettingsSchema = z.object({
  defaultLanguage: z.enum(['hi', 'en']).default('hi'),
  hours: z.array(GymHoursSchema).default([]),
  pricing: PricingSettingsSchema.prefault({}),
  membership: MembershipSettingsSchema.prefault({}),
  reminders: ReminderSettingsSchema.prefault({}),
  attendance: AttendanceSettingsSchema.prefault({}),
  privacy: PrivacySettingsSchema.prefault({}),
  features: FeatureFlagsSchema.prefault({}),
  trust: TrustNumbersSchema.prefault({}),
  promo: PromoSchema.prefault({}),
});
export type GymSettings = z.infer<typeof GymSettingsSchema>;

/** Every default, for seeding a new gym and for tests that need a baseline. */
export function defaultGymSettings(): GymSettings {
  return GymSettingsSchema.parse({});
}

/**
 * Reminder slots must sit inside quiet hours (testing-strategy.md §4 case R18).
 *
 * The slots live on `ReminderRule`, not in settings, so this is called by the
 * settings-update and rule-update services rather than by the schema itself —
 * either edit can break the invariant, and both must be rejected.
 */
export function slotsOutsideQuietHours(slots: readonly string[], quietHours: QuietHours): string[] {
  const from = minutesOfDay(quietHours.start);
  const to = minutesOfDay(quietHours.end);
  return slots.filter((slot) => {
    if (!isISTTime(slot)) return true;
    const at = minutesOfDay(istTime(slot));
    return at < from || at > to;
  });
}

export class QuietHoursViolationError extends Error {
  readonly slots: readonly string[];
  constructor(slots: readonly string[], quietHours: QuietHours) {
    super(
      `Reminder slot(s) ${slots.join(', ')} fall outside quiet hours ${quietHours.start}-${quietHours.end} (BR-5.3)`,
    );
    this.name = 'QuietHoursViolationError';
    this.slots = slots;
  }
}

export function assertSlotsWithinQuietHours(slots: readonly string[], quietHours: QuietHours): void {
  const bad = slotsOutsideQuietHours(slots, quietHours);
  if (bad.length > 0) {
    throw new QuietHoursViolationError(bad, quietHours);
  }
}
