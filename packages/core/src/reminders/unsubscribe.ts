import { todayIST, type Clock, type ISTDate } from '@mfp/shared';
import { diffDays } from '@mfp/shared';

/**
 * A member stops the messages themselves, or undoes it (BR-6).
 *
 * One tap does everything at once or nothing: the reminders stop, the member is marked
 * LEFT with the reason, the owner gets them on the call list and an alert, and a
 * confirmation goes back to the member. Tapping twice confirms again but changes
 * nothing else — the member should never be left wondering whether it worked, and the
 * owner should never see the same person twice on the list.
 *
 * Nothing here talks to WhatsApp: the confirmations leave through the outbox, so they
 * are sent only if the transaction commits (system-architecture §5).
 */

export interface UnsubscribeMemberRow {
  readonly id: string;
  readonly status: string;
  readonly remindersUnsubscribedAt: Date | null;
  readonly leftAt: string | null;
}

export interface UnsubscribeStore {
  findMember(gymId: string, memberId: string): Promise<UnsubscribeMemberRow | null>;
  /** False when they were already unsubscribed: the update is conditional, so this is atomic. */
  markUnsubscribed(memberId: string, at: Date, leftOn: ISTDate): Promise<boolean>;
  markResubscribed(memberId: string): Promise<boolean>;
  createCallTask(task: { readonly memberId: string; readonly reason: 'UNSUBSCRIBED'; readonly priority: number; readonly dueDate: ISTDate }): Promise<void>;
  createAlert(type: 'MEMBER_UNSUBSCRIBED', memberId: string): Promise<void>;
  writeAudit(entry: { readonly action: string; readonly actorType: 'member'; readonly memberId: string }): Promise<void>;
  enqueueOutbox(event: { readonly type: string; readonly dedupeKey: string; readonly payload: Readonly<Record<string, unknown>> }): Promise<void>;
}

export interface UnsubscribeDeps {
  readonly clock: Clock;
  readonly gymId: string;
  readonly uow: { transaction: <T>(work: (store: UnsubscribeStore) => Promise<T>) => Promise<T> };
}

export type UnsubscribeResult = { readonly outcome: 'UNSUBSCRIBED' | 'ALREADY_UNSUBSCRIBED' | 'NOT_FOUND' };
export type RestartResult = { readonly outcome: 'RESTARTED' | 'WINDOW_EXPIRED' | 'NOT_UNSUBSCRIBED' | 'NOT_FOUND' };

/** BR-7: "ask them why" sits at the bottom of the call list. */
const UNSUBSCRIBED_CALL_PRIORITY = 6;

export async function unsubscribeMember(input: { memberId: string }, deps: UnsubscribeDeps): Promise<UnsubscribeResult> {
  const now = deps.clock.now();
  const today = todayIST(deps.clock);

  return deps.uow.transaction(async (store) => {
    const member = await store.findMember(deps.gymId, input.memberId);
    if (member === null) return { outcome: 'NOT_FOUND' };

    const changed = await store.markUnsubscribed(input.memberId, now, today);
    if (!changed) {
      // Already unsubscribed. Confirm once more — the dedupe key holds it to one a day —
      // and leave the owner's list and the audit alone.
      await store.enqueueOutbox({ type: 'whatsapp.unsubscribe_confirm', dedupeKey: `unsubconf:${input.memberId}:${today}`, payload: { memberId: input.memberId } });
      return { outcome: 'ALREADY_UNSUBSCRIBED' };
    }

    await store.createCallTask({ memberId: input.memberId, reason: 'UNSUBSCRIBED', priority: UNSUBSCRIBED_CALL_PRIORITY, dueDate: today });
    await store.createAlert('MEMBER_UNSUBSCRIBED', input.memberId);
    await store.writeAudit({ action: 'member.unsubscribed', actorType: 'member', memberId: input.memberId });
    await store.enqueueOutbox({ type: 'whatsapp.unsubscribe_confirm', dedupeKey: `unsubconf:${input.memberId}:${today}`, payload: { memberId: input.memberId } });
    // The kiosk gallery holds only active members (BR-9.5), so it has to be rebuilt.
    await store.enqueueOutbox({ type: 'kiosk.gallery_changed', dedupeKey: `gallery:${input.memberId}:${today}`, payload: { memberId: input.memberId } });
    return { outcome: 'UNSUBSCRIBED' };
  });
}

export async function restartReminders(input: { memberId: string; restartWindowDays: number }, deps: UnsubscribeDeps): Promise<RestartResult> {
  const today = todayIST(deps.clock);

  return deps.uow.transaction(async (store) => {
    const member = await store.findMember(deps.gymId, input.memberId);
    if (member === null) return { outcome: 'NOT_FOUND' };
    if (member.remindersUnsubscribedAt === null) return { outcome: 'NOT_UNSUBSCRIBED' };

    // BR-6.4: after the window only the owner can bring them back, because by then the
    // gym has usually had the conversation.
    const unsubscribedOn = new Date(member.remindersUnsubscribedAt.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10) as ISTDate;
    if (diffDays(today, unsubscribedOn) > input.restartWindowDays) return { outcome: 'WINDOW_EXPIRED' };

    if (!(await store.markResubscribed(input.memberId))) return { outcome: 'NOT_UNSUBSCRIBED' };
    await store.writeAudit({ action: 'member.reminders_restarted', actorType: 'member', memberId: input.memberId });
    await store.enqueueOutbox({ type: 'whatsapp.restart_confirm', dedupeKey: `restartconf:${input.memberId}:${today}`, payload: { memberId: input.memberId } });
    await store.enqueueOutbox({ type: 'kiosk.gallery_changed', dedupeKey: `gallery:${input.memberId}:${today}`, payload: { memberId: input.memberId } });
    return { outcome: 'RESTARTED' };
  });
}
