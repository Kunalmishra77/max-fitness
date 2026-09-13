import { toISTDate, type FeeState, type ISTDate, type MemberStatus } from '@mfp/shared';

/**
 * Attendance cooldown and eligibility (BR-9).
 *
 * A gym kiosk sees the same face repeatedly: someone walks past on the way to the
 * water cooler, or the camera catches them twice in a second. BR-9.1 collapses
 * those into one visit per ⚙ 180 minutes.
 */

export const COOLDOWN_DECISIONS = ['RECORD', 'WITHIN_COOLDOWN', 'DUPLICATE_EVENT'] as const;
export type CooldownDecision = (typeof COOLDOWN_DECISIONS)[number];

export interface CooldownInput {
  readonly capturedAt: Date;
  /** The member's most recent non-voided attendance, or `null` for a first visit. */
  readonly lastAttendanceAt: Date | null;
  readonly cooldownMinutes: number;
  /** True when this `clientEventId` is already stored — the kiosk retried an upload. */
  readonly isDuplicateEventId?: boolean;
}

/**
 * Whether to record this check-in.
 *
 * The boundary is exclusive on the cooldown: at exactly 180 minutes the visit
 * counts (testing-strategy.md §6 pins 179 vs 181, and 180 itself must be decided —
 * we treat the window as "less than N minutes since the last one").
 */
export function cooldownDecision(input: CooldownInput): CooldownDecision {
  if (input.isDuplicateEventId === true) {
    return 'DUPLICATE_EVENT';
  }
  if (input.lastAttendanceAt === null) {
    return 'RECORD';
  }
  const minutesSince = (input.capturedAt.getTime() - input.lastAttendanceAt.getTime()) / 60_000;
  // A clock-skewed event from the past is not a new visit either.
  if (minutesSince < input.cooldownMinutes) {
    return 'WITHIN_COOLDOWN';
  }
  return 'RECORD';
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
