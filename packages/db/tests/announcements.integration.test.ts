/**
 * The owner's announcement, against a real database (ADR-079).
 *
 * The domain is tested with a fake store; what can only be checked here is the wiring
 * nobody else sees — that the audience query picks the right members, that one outbox
 * event per member survives a real unique constraint, that the count the owner is shown
 * before sending matches what actually gets queued, and that a member who unsubscribes
 * afterwards is refused at send time rather than messaged anyway.
 *
 * Everything is written under a throwaway gym and deleted afterwards.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { istTime } from '@mfp/shared';
import { sendAnnouncement, type CrmActor } from '@mfp/core';
import { createPrismaClient, type PrismaClient } from '../src/client';
import { PrismaAnnouncements, PrismaAnnouncementUnitOfWork } from '../src/repositories/announcement.repository';
import { integrationSuite, testDatabaseUrl } from './support';

const run = randomBytes(5).toString('hex');
const gymId = `gym_it_ann_${run}`;
const ownerId = `staff_it_ann_${run}`;
const now = new Date('2026-09-25T05:00:00.000Z'); // 10:30 IST

const suite = integrationSuite('announcements');

suite('announcements against Postgres', () => {
  let prisma: PrismaClient;
  let announcements: PrismaAnnouncements;
  let uow: PrismaAnnouncementUnitOfWork;

  const owner: CrmActor = {
    staffUserId: ownerId,
    gymId,
    role: 'OWNER',
    // The PIN was entered a moment ago; this is what `settings.manage` insists on.
    elevatedUntil: new Date('2026-09-25T05:04:00.000Z'),
    receptionMayTakePayments: true,
  };

  async function member(
    key: string,
    over: { status?: 'ACTIVE' | 'PENDING_PAYMENT'; whatsappOptIn?: boolean; unsubscribed?: boolean; language?: 'hi' | 'en' } = {},
  ): Promise<string> {
    const id = `mem_it_ann_${run}_${key}`;
    await prisma.member.create({
      data: {
        id,
        gymId,
        fullName: `Ann ${key} Tester`,
        mobile: `+9190004${key.padStart(5, '0')}`,
        gender: 'MALE',
        status: over.status ?? 'ACTIVE',
        source: 'WALK_IN',
        language: over.language ?? 'hi',
        whatsappOptIn: over.whatsappOptIn ?? true,
        ...(over.unsubscribed === true ? { remindersUnsubscribedAt: new Date('2026-09-01T00:00:00Z') } : {}),
      },
    });
    return id;
  }

  const send = (audience: 'ACTIVE' | 'EVERYONE' = 'ACTIVE') =>
    sendAnnouncement(
      { textEn: 'Closed tomorrow for Diwali.', textHi: 'कल दिवाली के कारण बंद रहेगा।', audience },
      {
        actor: owner,
        gymId,
        now,
        nowIST: istTime('10:30'),
        settings: { automaticPaused: false, quietHours: { start: istTime('08:00'), end: istTime('21:00') } },
        uow,
      },
    );

  beforeAll(async () => {
    prisma = createPrismaClient({ connectionString: testDatabaseUrl, poolMax: 4 });
    announcements = new PrismaAnnouncements(prisma);
    uow = new PrismaAnnouncementUnitOfWork(prisma);
    await prisma.gym.create({
      data: { id: gymId, slug: gymId, name: 'Announcement test gym', phone: '+919000000011', addressLine: 'Test', city: 'Test', state: 'Test', pincode: '000000', settings: {} },
    });
    await prisma.staffUser.create({
      data: { id: ownerId, gymId, name: 'Announcement Owner', mobile: `+9190004${run.slice(0, 5)}`, role: 'OWNER', pinHash: 'not-used-here' },
    });
  });

  afterAll(async () => {
    if (prisma === undefined) return;
    await prisma.outboxEvent.deleteMany({ where: { gymId } });
    await prisma.messageLog.deleteMany({ where: { gymId } });
    await prisma.announcement.deleteMany({ where: { gymId } });
    await prisma.member.deleteMany({ where: { gymId } });
    await prisma.staffUser.deleteMany({ where: { gymId } });
    await prisma.gym.deleteMany({ where: { id: gymId } });
    await prisma.$disconnect();
  });

  it('queues one message per reachable member, and says so before it does', async () => {
    const reachableIds = [await member('01'), await member('02', { language: 'en' })];
    await member('03', { whatsappOptIn: false });
    await member('04', { unsubscribed: true });
    // Not on a running plan, so outside the "ACTIVE" audience entirely.
    await member('05', { status: 'PENDING_PAYMENT' });

    // The number the owner is shown before pressing send.
    expect(await announcements.reachableCount(gymId, 'ACTIVE')).toEqual({ reachable: 2, total: 4 });

    const result = await send();

    expect(result.queued).toBe(2);
    expect(result.skipped).toEqual({ noOptIn: 1, unsubscribed: 1, noMobile: 0 });

    const row = await prisma.announcement.findFirstOrThrow({ where: { gymId } });
    expect(row).toMatchObject({ audience: 'ACTIVE', recipientCount: 2, createdById: ownerId, textHi: 'कल दिवाली के कारण बंद रहेगा।' });

    const events = await prisma.outboxEvent.findMany({ where: { gymId, type: 'whatsapp.announcement' }, select: { dedupeKey: true } });
    expect(events.map((event) => event.dedupeKey).sort()).toEqual(reachableIds.map((id) => `announcement:${row.id}:${id}`).sort());
  });

  it('reaches the whole register when the owner chooses everyone', async () => {
    expect((await announcements.reachableCount(gymId, 'EVERYONE')).reachable).toBe(3);
  });

  it('hands the worker the words and the member, and refuses one who has since unsubscribed', async () => {
    const row = await prisma.announcement.findFirstOrThrow({ where: { gymId } });
    const memberId = `mem_it_ann_${run}_01`;

    const before = await announcements.forMember(row.id, memberId);
    expect(before).toMatchObject({ textHi: 'कल दिवाली के कारण बंद रहेगा।', stillEligible: true });
    expect(before?.member).toMatchObject({ firstName: 'Ann', language: 'hi' });

    // Between the owner pressing send and the worker reaching this member, they opt out.
    await prisma.member.update({ where: { id: memberId }, data: { remindersUnsubscribedAt: now } });
    expect((await announcements.forMember(row.id, memberId))?.stillEligible).toBe(false);
  });

  it('counts what actually left, not what was planned', async () => {
    const row = await prisma.announcement.findFirstOrThrow({ where: { gymId } });
    const memberId = `mem_it_ann_${run}_02`;
    await prisma.messageLog.create({
      data: {
        gymId,
        memberId,
        direction: 'OUTBOUND',
        purpose: 'ANNOUNCEMENT',
        status: 'SENT',
        idempotencyKey: `announcement:${row.id}:${memberId}`,
      },
    });

    const listed = (await announcements.recent(gymId)).find((item) => item.id === row.id);
    expect(listed).toMatchObject({ recipientCount: 2, sent: 1, byName: 'Announcement Owner' });
    expect((await announcements.latest(gymId))?.id).toBe(row.id);
  });

  it('cannot tell the same member twice, however often the send is repeated', async () => {
    const before = await prisma.outboxEvent.count({ where: { gymId, type: 'whatsapp.announcement' } });

    // A second announcement is a second row, so it legitimately queues again — what must
    // not happen is the same announcement queueing twice for one member.
    const row = await prisma.announcement.findFirstOrThrow({ where: { gymId } });
    const memberId = `mem_it_ann_${run}_02`;
    await prisma.outboxEvent.createMany({
      data: [{ gymId, type: 'whatsapp.announcement', payload: { announcementId: row.id, memberId }, dedupeKey: `announcement:${row.id}:${memberId}` }],
      skipDuplicates: true,
    });

    expect(await prisma.outboxEvent.count({ where: { gymId, type: 'whatsapp.announcement' } })).toBe(before);
  });
});
