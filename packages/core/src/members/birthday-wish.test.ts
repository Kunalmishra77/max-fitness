import { describe, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import type { OutboxEventInput } from '../ports/outbox';
import { sendBirthdayWish, type BirthdayWishMember, type BirthdayWishStore } from './birthday-wish';
import { assertCan, type CrmActor } from '../crm/permissions';

const TODAY = istDate('2026-09-23');
const NOW = new Date('2026-09-23T05:00:00Z');

const owner: CrmActor = { staffUserId: 'staff_1', gymId: 'gym_1', role: 'OWNER', elevatedUntil: null, receptionMayTakePayments: true };
const trainer: CrmActor = { ...owner, staffUserId: 'staff_2', role: 'TRAINER' };

const BIRTHDAY_GIRL: BirthdayWishMember = {
  memberId: 'mem_1',
  gymId: 'gym_1',
  fullName: 'Anita Rao',
  dob: istDate('1994-09-23'),
  status: 'ACTIVE',
  language: 'hi',
  whatsappOptIn: true,
  remindersUnsubscribedAt: null,
  hasMobile: true,
};

function store(member: BirthdayWishMember | null = BIRTHDAY_GIRL, wished = false) {
  const outbox: OutboxEventInput[] = [];
  const impl: BirthdayWishStore = {
    member: () => Promise.resolve(member),
    alreadySent: () => Promise.resolve(wished),
    enqueueOutbox: (event) => {
      outbox.push(event);
      return Promise.resolve();
    },
  };
  return { outbox, impl };
}

const send = (actor: CrmActor, s: ReturnType<typeof store>, memberId = 'mem_1') =>
  sendBirthdayWish({ memberId }, { actor, gymId: 'gym_1', today: TODAY, now: NOW, store: s.impl });

describe('sendBirthdayWish', () => {
  it('queues one wish, in the member’s language', async () => {
    const s = store();

    expect(await send(owner, s)).toEqual({ outcome: 'QUEUED' });
    expect(s.outbox).toEqual([
      {
        type: 'whatsapp.birthday',
        gymId: 'gym_1',
        payload: { memberId: 'mem_1', year: '2026' },
        dedupeKey: 'birthday:mem_1:2026',
      },
    ]);
  });

  it('will not wish the same person twice in a year', async () => {
    const s = store(BIRTHDAY_GIRL, true);

    expect(await send(owner, s)).toEqual({ outcome: 'ALREADY_SENT' });
    expect(s.outbox).toEqual([]);
  });

  it('refuses when it is not actually their birthday', async () => {
    const s = store({ ...BIRTHDAY_GIRL, dob: istDate('1994-09-24') });

    expect(await send(owner, s)).toEqual({ outcome: 'NOT_TODAY' });
    expect(s.outbox).toEqual([]);
  });

  it('greets a leap-day member on 28 February in a year without a 29th (BR-8.1)', async () => {
    const s = store({ ...BIRTHDAY_GIRL, dob: istDate('2000-02-29') });

    const result = await sendBirthdayWish(
      { memberId: 'mem_1' },
      { actor: owner, gymId: 'gym_1', today: istDate('2027-02-28'), now: NOW, store: s.impl },
    );

    expect(result).toEqual({ outcome: 'QUEUED' });
    expect(s.outbox[0]?.dedupeKey).toBe('birthday:mem_1:2027');
  });

  it.each([
    ['someone who has left', { status: 'LEFT' as const }],
    ['someone who never agreed to WhatsApp', { whatsappOptIn: false }],
    ['someone who unsubscribed', { remindersUnsubscribedAt: new Date('2026-09-01T00:00:00Z') }],
    ['someone with no number on file', { hasMobile: false }],
  ])('does not wish %s', async (_name, override) => {
    const s = store({ ...BIRTHDAY_GIRL, ...override });

    expect(await send(owner, s)).toEqual({ outcome: 'NOT_ELIGIBLE' });
    expect(s.outbox).toEqual([]);
  });

  it('says nothing about a member of another gym', async () => {
    const s = store({ ...BIRTHDAY_GIRL, gymId: 'gym_2' });

    expect(await send(owner, s)).toEqual({ outcome: 'NOT_FOUND' });
    expect(s.outbox).toEqual([]);
  });

  it('is not a trainer’s to send', async () => {
    const s = store();

    await expect(send(trainer, s)).rejects.toThrow();
    expect(s.outbox).toEqual([]);
  });

  it('checks the same capability the screen hides the button behind', () => {
    expect(() => assertCan(trainer, 'member.edit', NOW)).toThrow();
    expect(() => assertCan(owner, 'member.edit', NOW)).not.toThrow();
  });
});
