import { DUE_SOON_DAYS, compareISTDates, diffDays, type FeeState, type ISTDate } from '@mfp/shared';

/**
 * Fee state (BR-4.2) — the number the whole CRM is built around.
 *
 * Derived, never stored (database-design.md §1.3): a stored flag drifts the moment
 * a day passes without a job running, and "the member's card says PAID but their
 * membership ended last week" is exactly the failure this product exists to prevent.
 *
 * ADR-013: this function is canonical. `v_member_fee` is a read-model for fast list
 * queries and is diffed against this in an integration test; if they disagree, the
 * view is the bug.
 */

export interface MembershipForFeeState {
  readonly id: string;
  readonly startDate: ISTDate | null;
  readonly endDate: ISTDate;
  readonly status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED';
}

export interface FeeStateResult {
  readonly feeState: FeeState;
  /** `endDate − today`. 0 means the membership ends today (BR-4.2). `null` when NONE. */
  readonly daysLeft: number | null;
  /** The end date fee state was computed from, after any renewal-chain extension. */
  readonly effectiveEndDate: ISTDate | null;
  /** The membership that end date came from. */
  readonly membershipId: string | null;
  /** True when a future membership extended the effective end (BR-4.2 last sentence). */
  readonly extendedByUpcoming: boolean;
}

const NO_MEMBERSHIP: FeeStateResult = {
  feeState: 'NONE',
  daysLeft: null,
  effectiveEndDate: null,
  membershipId: null,
  extendedByUpcoming: false,
};

/**
 * Fee state from a member's memberships as at `today`.
 *
 * The rule (BR-4.2): take the membership covering today, or failing that the latest
 * one that has ended. Then, "if an upcoming membership starts the day after, use its
 * end date" — an early renewal must not show as due.
 *
 * ADR-014: that extension applies only to a membership starting within one day of
 * the current end, i.e. a genuine renewal chain. Simply taking the greatest end date
 * (as `v_member_fee` does) would report PAID for someone whose membership lapsed in
 * March and who has a booking starting next January.
 */
export function feeState(today: ISTDate, memberships: readonly MembershipForFeeState[]): FeeStateResult {
  const confirmed = memberships
    .filter((m) => m.status === 'CONFIRMED')
    .sort((a, b) => compareISTDates(a.endDate, b.endDate));

  if (confirmed.length === 0) {
    return NO_MEMBERSHIP;
  }

  // The membership covering today, if any.
  const current = confirmed.find(
    (m) =>
      compareISTDates(today, m.startDate ?? m.endDate) >= 0 && compareISTDates(today, m.endDate) <= 0,
  );

  // Otherwise the latest one that has already ended. A membership entirely in the
  // future does not make anyone a paid-up member today.
  const base =
    current ??
    [...confirmed].reverse().find((m) => compareISTDates(m.endDate, today) < 0) ??
    undefined;

  if (base === undefined) {
    // Only future memberships exist: nothing is in force today.
    return NO_MEMBERSHIP;
  }

  const chained = followRenewalChain(base, confirmed);
  const effectiveEndDate = chained.endDate;
  const daysLeft = diffDays(effectiveEndDate, today);

  return {
    feeState: classify(daysLeft),
    daysLeft,
    effectiveEndDate,
    membershipId: base.id,
    extendedByUpcoming: chained.id !== base.id,
  };
}

/**
 * Walk forward through memberships that begin the day after the previous one ends.
 *
 * Renewals chain contiguously (BR-3.4), so a member who renewed three months early
 * has two rows and the later one is what counts. A gap of even one day breaks the
 * chain: they were not a member on that day, and we do not paper over it.
 */
function followRenewalChain(
  base: MembershipForFeeState,
  confirmed: readonly MembershipForFeeState[],
): MembershipForFeeState {
  let node = base;
  const seen = new Set<string>([base.id]);

  for (;;) {
    const next = confirmed.find(
      (m) => !seen.has(m.id) && m.startDate !== null && diffDays(m.startDate, node.endDate) === 1,
    );
    if (next === undefined) return node;
    seen.add(next.id);
    node = next;
  }
}

/** BR-4.2's thresholds, kept in one place so the view and the UI cannot drift from them. */
export function classify(daysLeft: number): FeeState {
  if (daysLeft < 0) return 'EXPIRED';
  if (daysLeft <= DUE_SOON_DAYS) return 'DUE_SOON';
  return 'PAID';
}

/** Days a member has been expired; 0 while still valid. Drives BR-4.3 and BR-5.1 POST. */
export function daysExpired(today: ISTDate, effectiveEndDate: ISTDate | null): number {
  if (effectiveEndDate === null) return 0;
  return Math.max(0, diffDays(today, effectiveEndDate));
}

/**
 * BR-4.3: an ACTIVE member expired for ⚙ 60 days with no payment becomes LEFT.
 *
 * The rule also requires that a call task was raised at least once first — nobody
 * is written off without someone having tried to ring them.
 */
export function shouldAutoMarkLeft(input: {
  readonly today: ISTDate;
  readonly memberStatus: string;
  readonly effectiveEndDate: ISTDate | null;
  readonly autoLeftAfterDays: number;
  readonly hadCallTask: boolean;
}): boolean {
  if (input.memberStatus !== 'ACTIVE') return false;
  if (!input.hadCallTask) return false;
  return daysExpired(input.today, input.effectiveEndDate) >= input.autoLeftAfterDays;
}

/** i18n key for the fee-state chip, e.g. `crm.feeState.dueSoon` (coding-standards.md §3). */
export function feeStateLabelKey(state: FeeState): string {
  const suffix = {
    PAID: 'paid',
    DUE_SOON: 'dueSoon',
    EXPIRED: 'expired',
    NONE: 'none',
  }[state];
  return `crm.feeState.${suffix}`;
}
