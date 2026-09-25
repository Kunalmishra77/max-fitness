import { beforeEach, describe, expect, it } from 'vitest';
import { istTime } from '@mfp/shared';
import { DEFAULT_QUIET_HOURS } from '../testing/builders';
import type { CrmActor } from '../crm/permissions';
import type { OutboxEventInput } from '../ports/outbox';
import {
  announcementBodyFor,
  ANNOUNCEMENT_MAX_CHARS,
  sendAnnouncement,
  type AnnouncementAudience,
  type AnnouncementMember,
  type AnnouncementRecord,
  type AnnouncementStore,
} from './announcement';

/**
 * "Kal gym band rahega" — the owner tells every member at once (client request,
 * 2026-09-25).
 *
 * It is the only action in the product that messages the whole register, so it is the
 * owner's alone, it says how many phones it will reach before it reaches them, and it
 * refuses at the two moments when sending would be a mistake: while the gym has
 * automatic messages switched off, and outside the hours members agreed to be messaged.
 */

const now = new Date('2026-09-25T05:00:00.000Z'); // 10:30 IST
const owner: CrmActor = { staffUserId: 'staff_1', gymId: 'gym_1', role: 'OWNER', elevatedUntil: new Date('2026-09-25T05:04:00.000Z'), receptionMayTakePayments: true };
const reception: CrmActor = { ...owner, staffUserId: 'staff_2', role: 'RECEPTION' };
const stale: CrmActor = { ...owner, elevatedUntil: new Date('2026-09-25T04:50:00.000Z') };

function member(memberId: string, over: Partial<AnnouncementMember> = {}): AnnouncementMember {
  return { memberId, language: 'hi', whatsappOptIn: true, remindersUnsubscribedAt: null, hasMobile: true, ...over };
}

class FakeStore implements AnnouncementStore {
  members: AnnouncementMember[] = [member('mem_1'), member('mem_2', { language: 'en' })];
  askedFor: AnnouncementAudience | null = null;
  created: AnnouncementRecord[] = [];
  queued: OutboxEventInput[] = [];

  audience(_gymId: string, audience: AnnouncementAudience) {
    this.askedFor = audience;
    return Promise.resolve(this.members);
  }
  create(record: AnnouncementRecord) {
    this.created.push(record);
    return Promise.resolve('ann_1');
  }
  enqueueOutbox(events: readonly OutboxEventInput[]) {
    this.queued.push(...events);
    return Promise.resolve();
  }
}

describe('sendAnnouncement', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  const send = (
    input: { textEn?: string; textHi?: string; audience?: AnnouncementAudience } = {},
    over: { actor?: CrmActor; paused?: boolean; at?: string } = {},
  ) =>
    sendAnnouncement(
      {
        textEn: input.textEn ?? 'The gym is closed tomorrow for Diwali.',
        textHi: input.textHi ?? 'कल दिवाली के कारण जिम बंद रहेगा।',
        audience: input.audience ?? 'ACTIVE',
      },
      {
        actor: over.actor ?? owner,
        gymId: 'gym_1',
        now,
        nowIST: istTime(over.at ?? '10:30'),
        settings: { automaticPaused: over.paused ?? false, quietHours: DEFAULT_QUIET_HOURS },
        uow: { transaction: (work) => work(store) },
      },
    );

  it('records the announcement and queues one message per member, in their own language', async () => {
    const result = await send();

    expect(result).toEqual({ announcementId: 'ann_1', queued: 2, skipped: { noOptIn: 0, unsubscribed: 0, noMobile: 0 } });
    expect(store.askedFor).toBe('ACTIVE');
    expect(store.created).toEqual([
      {
        gymId: 'gym_1',
        textEn: 'The gym is closed tomorrow for Diwali.',
        textHi: 'कल दिवाली के कारण जिम बंद रहेगा।',
        audience: 'ACTIVE',
        createdById: 'staff_1',
        sentAt: now,
        recipientCount: 2,
      },
    ]);
    // One event per member, each named so a repeat cannot message anybody twice.
    expect(store.queued).toEqual([
      { type: 'whatsapp.announcement', gymId: 'gym_1', payload: { announcementId: 'ann_1', memberId: 'mem_1' }, dedupeKey: 'announcement:ann_1:mem_1' },
      { type: 'whatsapp.announcement', gymId: 'gym_1', payload: { announcementId: 'ann_1', memberId: 'mem_2' }, dedupeKey: 'announcement:ann_1:mem_2' },
    ]);
  });

  it('counts who it cannot reach instead of quietly missing them', async () => {
    store.members = [
      member('mem_1'),
      member('mem_2', { whatsappOptIn: false }),
      member('mem_3', { remindersUnsubscribedAt: new Date('2026-09-01T00:00:00.000Z') }),
      member('mem_4', { hasMobile: false }),
    ];

    const result = await send();

    expect(result.queued).toBe(1);
    expect(result.skipped).toEqual({ noOptIn: 1, unsubscribed: 1, noMobile: 1 });
    expect(store.created[0]?.recipientCount).toBe(1);
  });

  it('says so rather than sending nothing at all when nobody can be reached', async () => {
    store.members = [member('mem_1', { whatsappOptIn: false })];

    await expect(send()).rejects.toMatchObject({ code: 'VALIDATION_FAILED', meta: { field: 'audience' } });
    expect(store.created).toEqual([]);
    expect(store.queued).toEqual([]);
  });

  it('will not shout while the gym has automatic messages switched off', async () => {
    // That switch is usually flipped because WhatsApp has flagged the number. Sending
    // two hundred marketing messages at that moment is the worst available move.
    await expect(send({}, { paused: true })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(store.queued).toEqual([]);
  });

  it('will not wake anybody at two in the morning', async () => {
    await expect(send({}, { at: '02:30' })).rejects.toMatchObject({ code: 'QUIET_HOURS_VIOLATION' });
    await expect(send({}, { at: '21:30' })).rejects.toMatchObject({ code: 'QUIET_HOURS_VIOLATION' });
    expect(store.queued).toEqual([]);
  });

  it('is the owner’s alone, and only with the PIN just entered', async () => {
    await expect(send({}, { actor: reception })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(send({}, { actor: stale })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('needs words in at least one language, and refuses more than a message can hold', async () => {
    await expect(send({ textEn: '   ', textHi: '  ' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', meta: { field: 'text' } });
    await expect(send({ textEn: 'x'.repeat(ANNOUNCEMENT_MAX_CHARS + 1) })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', meta: { field: 'text' } });
    // One language is enough: the other falls back to it.
    await expect(send({ textHi: '' })).resolves.toMatchObject({ queued: 2 });
  });

  it('folds the text onto one line, because a template variable cannot hold a newline', async () => {
    await send({ textEn: 'Closed tomorrow.\n\nOpen again on Friday.  ', textHi: 'कल बंद।\nशुक्रवार से खुला।' });

    expect(store.created[0]?.textEn).toBe('Closed tomorrow. Open again on Friday.');
    expect(store.created[0]?.textHi).toBe('कल बंद। शुक्रवार से खुला।');
  });
});

describe('announcementBodyFor', () => {
  it('gives a member the text in their language', () => {
    expect(announcementBodyFor({ textEn: 'Closed', textHi: 'बंद' }, 'hi')).toBe('बंद');
    expect(announcementBodyFor({ textEn: 'Closed', textHi: 'बंद' }, 'en')).toBe('Closed');
  });

  it('falls back rather than sending an empty message', () => {
    expect(announcementBodyFor({ textEn: 'Closed', textHi: '' }, 'hi')).toBe('Closed');
    expect(announcementBodyFor({ textEn: '', textHi: 'बंद' }, 'en')).toBe('बंद');
  });
});
