import { buildOwnerDigest, planOwnerAlerts, type OwnerDigestCounts, type PendingOwnerAlert, type TransactionalMessage } from '@mfp/core';
import { addDays, todayIST, type Clock, type ISTDate, type Language } from '@mfp/shared';

/**
 * The two jobs that talk to the owner (whatsapp-automation-engine §8).
 *
 * `runOwnerDigest` fires once, at 08:30, and says nothing at all on a day with
 * nothing to say — an owner who gets "0, 0, 0, 0, 0" every morning stops reading the
 * message that matters. `runOwnerAlerts` runs often and is rationed instead: past
 * three messages in five minutes the rest arrive as one.
 *
 * As with the reminder jobs, the caller brings the clock, the repositories and the
 * sending, so both can be exercised without a database or a provider.
 */

export interface OwnerRecipientView {
  readonly staffUserId: string;
  readonly firstName: string;
  readonly mobile: string;
  readonly language: Language;
}

/** Sends one built message and records it; the caller decides how (see `deliverOwnerMessage`). */
type Deliver = (message: TransactionalMessage, to: string) => Promise<void>;

export interface OwnerDigestDeps {
  readonly clock: Clock;
  readonly owner: () => Promise<OwnerRecipientView | null>;
  readonly counts: (today: ISTDate, yesterday: ISTDate) => Promise<OwnerDigestCounts>;
  readonly deliver: Deliver;
  /** False when today's digest has already been claimed by an earlier fire. */
  readonly claimRun: (runKey: string) => Promise<boolean>;
  /** The owner's own "stop all automatic messages" switch (BR-9, §9). */
  readonly automaticPaused: () => Promise<boolean>;
}

export interface OwnerDigestResult {
  readonly sent: boolean;
  readonly reason?: 'NO_OWNER' | 'PAUSED' | 'ALREADY_RUN' | 'NOTHING_TO_SAY';
}

function worthSending(counts: OwnerDigestCounts): boolean {
  return (
    counts.endingToday > 0 ||
    counts.overdue > 0 ||
    counts.dueThisWeek > 0 ||
    counts.callsToday > 0 ||
    counts.birthdays > 0 ||
    counts.collectedYesterdayPaise > 0
  );
}

export async function runOwnerDigest(deps: OwnerDigestDeps): Promise<OwnerDigestResult> {
  const owner = await deps.owner();
  if (owner === null) return { sent: false, reason: 'NO_OWNER' };

  // "Stop all automatic messages" means all of them. An owner who pulls that switch
  // because WhatsApp has flagged the number does not want the gym still sending.
  if (await deps.automaticPaused()) return { sent: false, reason: 'PAUSED' };

  const today = todayIST(deps.clock);
  if (!(await deps.claimRun(today))) return { sent: false, reason: 'ALREADY_RUN' };

  const counts = await deps.counts(today, addDays(today, -1));
  if (!worthSending(counts)) return { sent: false, reason: 'NOTHING_TO_SAY' };

  await deps.deliver(
    buildOwnerDigest({ ownerId: owner.staffUserId, firstName: owner.firstName, language: owner.language, today, counts }),
    owner.mobile,
  );
  return { sent: true };
}

export interface OwnerAlertsDeps {
  readonly clock: Clock;
  readonly owner: () => Promise<OwnerRecipientView | null>;
  /** `send` is what to tell the owner; `drop` is what is too old to be news. */
  readonly pending: (since: Date) => Promise<{ send: PendingOwnerAlert[]; drop: string[] }>;
  /** Individual alerts already sent inside the bundling window. */
  readonly sentInWindow: (since: Date) => Promise<number>;
  readonly deliver: Deliver;
  readonly markNotified: (ids: readonly string[], at: Date) => Promise<void>;
  /** The owner's own "stop all automatic messages" switch (BR-9, §9). */
  readonly automaticPaused: () => Promise<boolean>;
  /** How far back an unsent alert is still worth sending. */
  readonly backlogHours?: number;
  readonly windowMinutes?: number;
  readonly onError?: (error: unknown, alertIds: readonly string[]) => void;
}

export interface OwnerAlertsResult {
  readonly sent: number;
  readonly covered: number;
  readonly dropped: number;
}

const DEFAULT_BACKLOG_HOURS = 6;
const DEFAULT_WINDOW_MINUTES = 5;

export async function runOwnerAlerts(deps: OwnerAlertsDeps): Promise<OwnerAlertsResult> {
  // Nobody to tell: leave every alert unstamped so the owner hears about it once
  // there is an owner again.
  const owner = await deps.owner();
  if (owner === null) return { sent: 0, covered: 0, dropped: 0 };
  // Held, not dropped: the alerts are still there when the owner switches sending
  // back on, and the backlog window decides which are still worth hearing.
  if (await deps.automaticPaused()) return { sent: 0, covered: 0, dropped: 0 };

  const now = deps.clock.now();
  const windowMinutes = deps.windowMinutes ?? DEFAULT_WINDOW_MINUTES;
  const backlogSince = new Date(now.getTime() - (deps.backlogHours ?? DEFAULT_BACKLOG_HOURS) * 3_600_000);

  const { send, drop } = await deps.pending(backlogSince);
  if (drop.length > 0) await deps.markNotified(drop, now);
  if (send.length === 0) return { sent: 0, covered: 0, dropped: drop.length };

  const alreadySentInWindow = await deps.sentInWindow(new Date(now.getTime() - windowMinutes * 60_000));
  const plan = planOwnerAlerts({ pending: send, language: owner.language, windowMinutes, alreadySentInWindow });

  let sent = 0;
  let covered = 0;
  for (const planned of plan) {
    try {
      await deps.deliver(planned.message, owner.mobile);
    } catch (error) {
      // Unstamped, so the next run tries again. Carry on with the rest: one bad
      // alert must not hold up the one the owner actually needs.
      deps.onError?.(error, planned.alertIds);
      continue;
    }
    await deps.markNotified(planned.alertIds, now);
    sent += 1;
    covered += planned.alertIds.length;
  }

  return { sent, covered, dropped: drop.length };
}
