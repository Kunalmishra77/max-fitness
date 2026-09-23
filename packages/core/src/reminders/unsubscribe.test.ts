import { beforeEach, describe, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import { fakeClockAt } from '../testing/builders';
import { restartReminders, unsubscribeMember, type UnsubscribeStore } from './unsubscribe';

/**
 * A member stops the messages themselves (BR-6).
 *
 * One tap has to do everything at once — stop the reminders, mark them LEFT, put them on
 * the owner's call list and confirm it to them — or none of it. Tapping twice must not
 * double any of that, and the same person may undo it themselves inside the window.
 */

const clock = fakeClockAt('2026-09-23T11:00');
const TODAY = istDate('2026-09-23');

class FakeStore implements UnsubscribeStore {
  member: { id: string; status: string; remindersUnsubscribedAt: Date | null; leftAt: string | null } | null = {
    id: 'mem_1',
    status: 'ACTIVE',
    remindersUnsubscribedAt: null,
    leftAt: null,
  };
  calls: Array<Record<string, unknown>> = [];
  alerts: string[] = [];
  audits: Array<Record<string, unknown>> = [];
  outbox: Array<Record<string, unknown>> = [];

  findMember(_gymId: string, memberId: string) {
    return Promise.resolve(this.member !== null && this.member.id === memberId ? { ...this.member } : null);
  }
  markUnsubscribed(memberId: string, at: Date, leftOn: string) {
    if (this.member === null || this.member.id !== memberId || this.member.remindersUnsubscribedAt !== null) return Promise.resolve(false);
    this.member = { ...this.member, status: 'LEFT', remindersUnsubscribedAt: at, leftAt: leftOn };
    return Promise.resolve(true);
  }
  markResubscribed(memberId: string) {
    if (this.member === null || this.member.id !== memberId || this.member.remindersUnsubscribedAt === null) return Promise.resolve(false);
    this.member = { ...this.member, status: 'ACTIVE', remindersUnsubscribedAt: null, leftAt: null };
    return Promise.resolve(true);
  }
  createCallTask(task: Record<string, unknown>) {
    this.calls.push(task);
    return Promise.resolve();
  }
  createAlert(type: string) {
    this.alerts.push(type);
    return Promise.resolve();
  }
  writeAudit(entry: Record<string, unknown>) {
    this.audits.push(entry);
    return Promise.resolve();
  }
  enqueueOutbox(event: Record<string, unknown>) {
    this.outbox.push(event);
    return Promise.resolve();
  }
}

let store: FakeStore;
const deps = () => ({ clock, gymId: 'gym_1', uow: { transaction: <T>(work: (s: UnsubscribeStore) => Promise<T>) => work(store) } });

beforeEach(() => {
  store = new FakeStore();
});

describe('unsubscribeMember', () => {
  it('stops the messages, marks them left, calls the owner’s list and confirms it', async () => {
    const result = await unsubscribeMember({ memberId: 'mem_1' }, deps());

    expect(result).toEqual({ outcome: 'UNSUBSCRIBED' });
    expect(store.member).toMatchObject({ status: 'LEFT', leftAt: TODAY });
    expect(store.member?.remindersUnsubscribedAt).toEqual(clock.now());
    expect(store.calls).toEqual([{ memberId: 'mem_1', reason: 'UNSUBSCRIBED', priority: 6, dueDate: TODAY }]);
    expect(store.alerts).toEqual(['MEMBER_UNSUBSCRIBED']);
    expect(store.audits).toEqual([{ action: 'member.unsubscribed', actorType: 'member', memberId: 'mem_1' }]);
    expect(store.outbox).toEqual([
      expect.objectContaining({ type: 'whatsapp.unsubscribe_confirm', dedupeKey: 'unsubconf:mem_1:2026-09-23' }),
      expect.objectContaining({ type: 'kiosk.gallery_changed', dedupeKey: 'gallery:mem_1:2026-09-23' }),
    ]);
  });

  it('confirms again but changes nothing when the same button is tapped twice', async () => {
    await unsubscribeMember({ memberId: 'mem_1' }, deps());
    store.calls = [];
    store.alerts = [];
    store.audits = [];
    store.outbox = [];

    const again = await unsubscribeMember({ memberId: 'mem_1' }, deps());

    expect(again).toEqual({ outcome: 'ALREADY_UNSUBSCRIBED' });
    expect(store.calls).toEqual([]);
    expect(store.alerts).toEqual([]);
    expect(store.audits).toEqual([]);
    // The confirmation still goes, once a day, so the member is not left wondering.
    expect(store.outbox).toEqual([expect.objectContaining({ type: 'whatsapp.unsubscribe_confirm', dedupeKey: 'unsubconf:mem_1:2026-09-23' })]);
  });

  it('says so when the member is not there at all', async () => {
    store.member = null;
    await expect(unsubscribeMember({ memberId: 'mem_x' }, deps())).resolves.toEqual({ outcome: 'NOT_FOUND' });
  });
});

describe('restartReminders', () => {
  it('puts everything back when the member undoes it inside the window', async () => {
    await unsubscribeMember({ memberId: 'mem_1' }, deps());
    store.outbox = [];

    const result = await restartReminders({ memberId: 'mem_1', restartWindowDays: 7 }, deps());

    expect(result).toEqual({ outcome: 'RESTARTED' });
    expect(store.member).toMatchObject({ status: 'ACTIVE', remindersUnsubscribedAt: null, leftAt: null });
    expect(store.audits.at(-1)).toEqual({ action: 'member.reminders_restarted', actorType: 'member', memberId: 'mem_1' });
    expect(store.outbox).toEqual([
      expect.objectContaining({ type: 'whatsapp.restart_confirm', dedupeKey: 'restartconf:mem_1:2026-09-23' }),
      expect.objectContaining({ type: 'kiosk.gallery_changed', dedupeKey: 'gallery:mem_1:2026-09-23' }),
    ]);
  });

  it('refuses after the window: only the owner can bring them back then (BR-6.4)', async () => {
    store.member = { id: 'mem_1', status: 'LEFT', remindersUnsubscribedAt: new Date('2026-09-15T11:00:00Z'), leftAt: '2026-09-15' };

    const result = await restartReminders({ memberId: 'mem_1', restartWindowDays: 7 }, deps());

    expect(result).toEqual({ outcome: 'WINDOW_EXPIRED' });
    expect(store.member).toMatchObject({ status: 'LEFT' });
  });

  it('allows it on the last day of the window, and not the day after', async () => {
    // Exactly seven days ago, IST.
    store.member = { id: 'mem_1', status: 'LEFT', remindersUnsubscribedAt: new Date('2026-09-16T05:30:00Z'), leftAt: '2026-09-16' };
    expect(await restartReminders({ memberId: 'mem_1', restartWindowDays: 7 }, deps())).toEqual({ outcome: 'RESTARTED' });

    store.member = { id: 'mem_1', status: 'LEFT', remindersUnsubscribedAt: new Date('2026-09-15T05:30:00Z'), leftAt: '2026-09-15' };
    expect(await restartReminders({ memberId: 'mem_1', restartWindowDays: 7 }, deps())).toEqual({ outcome: 'WINDOW_EXPIRED' });
  });

  it('does nothing when they never unsubscribed', async () => {
    await expect(restartReminders({ memberId: 'mem_1', restartWindowDays: 7 }, deps())).resolves.toEqual({ outcome: 'NOT_UNSUBSCRIBED' });
  });
});
