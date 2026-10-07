import { toISTDate, type FeeState, type ISTDate, type MemberStatus } from '@mfp/shared';

/**
 * Attendance: one visit per day (BR-9; owner, 2026-10-07).
 *
 * **A member counts once a day, whether they come in the morning or the evening.** The
 * owner put it plainly — "in india 1 din me ek bar attendance" — and it is the right rule
 * for a gym register: what the gym wants to know is how many *days* a member turned up, not
 * how many times they walked past the desk. Somebody who trains twice is still one day.
 *
 * It replaces a 180-minute cooldown, which answered a narrower question — the camera
 * catching one face twice in a second — and happened to let a morning and an evening visit
 * both count. The day rule covers the camera case as well, since two frames a second apart
 * are obviously the same day.
 *
 * The day is the **Asia/Kolkata** one (BR-9.2). Deciding in UTC would put a 1am visit on the
 * previous day and refuse a member their morning.
 */

export const COOLDOWN_DECISIONS = ['RECORD', 'ALREADY_TODAY', 'DUPLICATE_EVENT'] as const;
export type CooldownDecision = (typeof COOLDOWN_DECISIONS)[number];

export interface CooldownInput {
  readonly capturedAt: Date;
  /** The member's most recent non-voided attendance, or `null` for a first visit. */
  readonly lastAttendanceAt: Date | null;
  /**
   * Kept for the settings shape and for callers that still pass it, and deliberately unused:
   * the day decides, not an interval. Removing it would be a migration for nothing, and
   * leaving it silently honoured would be two rules disagreeing.
   */
  readonly cooldownMinutes?: number;
  /** True when this `clientEventId` is already stored — the kiosk retried an upload. */
  readonly isDuplicateEventId?: boolean;
}

/**
 * Whether to record this check-in.
 *
 * One per Asia/Kolkata day. A visit earlier the same day — an hour ago or eleven — is the
 * same day's attendance, and so is a clock-skewed event that claims to be from the future,
 * because the day is what is being compared and not the gap.
 */
export function cooldownDecision(input: CooldownInput): CooldownDecision {
  if (input.isDuplicateEventId === true) {
    return 'DUPLICATE_EVENT';
  }
  if (input.lastAttendanceAt === null) {
    return 'RECORD';
  }
  return attendanceDateOf(input.capturedAt) === attendanceDateOf(input.lastAttendanceAt) ? 'ALREADY_TODAY' : 'RECORD';
}

export function shouldRecordAttendance(input: CooldownInput): boolean {
  return cooldownDecision(input) === 'RECORD';
}

/** BR-9.2: the attendance "day" is the IST date of `capturedAt`. */
export function attendanceDateOf(capturedAt: Date): ISTDate {
  return toISTDate(capturedAt);
}

/**
 * BR-9.2: the kiosk may be offline for hours and its clock may drift, so the server
 * hands back its own time on each heartbeat and the device stores the offset.
 * Applying it here keeps a check-in on the right calendar day.
 */
export function correctForDeviceOffset(capturedAt: Date, deviceOffsetMs: number): Date {
  return new Date(capturedAt.getTime() - deviceOffsetMs);
}

// ── Kiosk gallery eligibility (BR-9.5) ───────────────────────────────────────

export interface GalleryEligibilityInput {
  readonly memberStatus: MemberStatus;
  readonly faceConsent: boolean;
  readonly isMinor: boolean;
  readonly hasParentalConsent: boolean;
}

/**
 * Who the kiosk is allowed to recognise.
 *
 * BR-9.5 and BR-12.2: no consent, no face. A minor needs a parent's consent
 * recorded by staff on top of their own. This gate is why a LEFT member stops being
 * matched on the next sync, and why their templates are deleted 30 days later
 * (BR-6.6).
 */
export function isEligibleForKioskGallery(input: GalleryEligibilityInput): boolean {
  if (input.memberStatus !== 'ACTIVE') return false;
  if (!input.faceConsent) return false;
  if (input.isMinor && !input.hasParentalConsent) return false;
  return true;
}

// ── What the kiosk says (BR-9.3) ─────────────────────────────────────────────

export type KioskGreeting =
  | { readonly kind: 'WELCOME'; readonly tone: 'green' }
  | { readonly kind: 'WELCOME_DUE_SOON'; readonly tone: 'amber'; readonly daysLeft: number }
  | { readonly kind: 'SEE_RECEPTION'; readonly tone: 'red' };

/**
 * BR-9.3. An expired member is told to see reception and, separately, generates a
 * priority-1 call task — the greeting is polite, the follow-up is what recovers the
 * membership.
 */
export function kioskGreetingFor(feeState: FeeState, daysLeft: number | null): KioskGreeting {
  switch (feeState) {
    case 'PAID':
      return { kind: 'WELCOME', tone: 'green' };
    case 'DUE_SOON':
      return { kind: 'WELCOME_DUE_SOON', tone: 'amber', daysLeft: daysLeft ?? 0 };
    case 'EXPIRED':
    case 'NONE':
      return { kind: 'SEE_RECEPTION', tone: 'red' };
  }
}
