/**
 * The members list, its fee filter and its counts, against a real database (ADR-097).
 *
 * The filter used to run in JavaScript **after** `take`, so asking for expired members
 * returned only the expired ones among the alphabetically-first page. At fourteen members
 * that is invisible; at a hundred and fifty it quietly hides people who owe money, which
 * is the one thing the screen exists to stop. The first test here is that bug, written so
 * it cannot come back.
 *
 * Everything is written under a throwaway gym and deleted afterwards.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { istDate, type ISTDate } from '@mfp/shared';
import { createPrismaClient, type PrismaClient } from '../src/client';
import { toDbDate } from '../src/dates';
import { PrismaCrmReader } from '../src/repositories/crm-read.repository';
import { integrationSuite, testDatabaseUrl } from './support';

const run = randomBytes(5).toString('hex');
const gymId = `gym_it_mlist_${run}`;
/**
 * The second gym the scoping test needs, named up here so `afterAll` can delete it.
 *
 * It used to be created and deleted inside that test, so an assertion failing in the
 * middle left a gym and a member behind for good. Six of them accumulated in one
 * afternoon of a failing run, which is how the twelve stray test gyms found on 2026-10-14
 * got there. Teardown belongs where it runs whether the test passed or not.
 */
const otherGymId = `${gymId}_other`;
const TODAY: ISTDate = istDate('2026-09-30');

const suite = integrationSuite('members list');

suite('members list against Postgres', () => {
  let prisma: PrismaClient;
  let reader: PrismaCrmReader;

  /**
   * `name` drives the alphabetical order the limit cuts on, which is the whole point of
   * the first test: the expired member is deliberately last in the alphabet.
   */
  async function member(key: string, name: string, endsOn: string | null): Promise<string> {
    const id = `mem_it_mlist_${run}_${key}`;
    await prisma.member.create({
      data: { id, gymId, fullName: name, mobile: `+9190005${key.padStart(5, '0')}`, gender: 'MALE', status: 'ACTIVE', source: 'WALK_IN' },
    });
    if (endsOn !== null) {
      await prisma.membership.create({
        data: {
          gymId,
          memberId: id,
          status: 'CONFIRMED',
          source: 'WALK_IN',
          startDate: toDbDate(istDate('2026-01-01')),
          endDate: toDbDate(istDate(endsOn)),
          pricePaise: 150000,
          durationMonths: 1,
        },
      });
    }
    return id;
  }

  beforeAll(async () => {
    prisma = createPrismaClient({ connectionString: testDatabaseUrl, poolMax: 4 });
    reader = new PrismaCrmReader(prisma);
    await prisma.gym.create({
      data: { id: gymId, slug: gymId, name: 'Members list test gym', phone: '+919000000012', addressLine: 'T', city: 'T', state: 'T', pincode: '000000', settings: {} },
    });

    // Three paid members early in the alphabet, one expired member last.
    await member('01', 'Aarav Paid', '2026-12-31');
    await member('02', 'Bhavna Paid', '2026-12-31');
    await member('03', 'Chetan Paid', '2026-12-31');
    await member('04', 'Zoya Expired', '2026-08-31');
    // And one with no membership at all, so NONE is represented.
    await member('05', 'Yash Nothing', null);
  });

  afterAll(async () => {
    if (prisma === undefined) return;
    await prisma.payment.deleteMany({ where: { gymId } });
    await prisma.membership.deleteMany({ where: { gymId } });
    await prisma.member.deleteMany({ where: { gymId: { in: [gymId, otherGymId] } } });
    await prisma.gym.deleteMany({ where: { id: { in: [gymId, otherGymId] } } });
    await prisma.$disconnect();
  });

  it('finds an expired member who falls outside the first page of names', async () => {
    // The bug: `take: 3` kept Aarav, Bhavna and Chetan — all paid — and the filter then
    // returned nothing, reporting a gym with no unpaid fees while Zoya owed a month.
    const expired = await reader.members(gymId, TODAY, { feeState: 'EXPIRED', limit: 3 });

    expect(expired.map((m) => m.fullName)).toEqual(['Zoya Expired']);
  });

  it('still honours the limit, counting only the members it was asked for', async () => {
    const paid = await reader.members(gymId, TODAY, { feeState: 'PAID', limit: 2 });

    expect(paid.map((m) => m.fullName)).toEqual(['Aarav Paid', 'Bhavna Paid']);
  });

  it('lists everybody when no fee filter is asked for', async () => {
    const all = await reader.members(gymId, TODAY, { limit: 50 });
    expect(all).toHaveLength(5);
  });

  it('combines the fee filter with a search rather than ignoring one of them', async () => {
    const found = await reader.members(gymId, TODAY, { feeState: 'PAID', search: 'Chetan', limit: 50 });
    expect(found.map((m) => m.fullName)).toEqual(['Chetan Paid']);

    const none = await reader.members(gymId, TODAY, { feeState: 'EXPIRED', search: 'Chetan', limit: 50 });
    expect(none).toEqual([]);
  });

  it('counts every fee state in one pass, so the filter chips can carry numbers', async () => {
    const counts = await reader.memberCounts(gymId, TODAY);

    expect(counts).toEqual({ total: 5, awaitingPayment: 0, PAID: 3, DUE_SOON: 0, EXPIRED: 1, NONE: 1 });
  });

  it('does not count or list another gym’s members', async () => {
    const otherGym = otherGymId;
    await prisma.gym.create({
      data: { id: otherGym, slug: otherGym, name: 'Other', phone: '+919000000013', addressLine: 'T', city: 'T', state: 'T', pincode: '000000', settings: {} },
    });
    await prisma.member.create({
      data: { id: `mem_it_mlist_${run}_other`, gymId: otherGym, fullName: 'Aaaa Stranger', mobile: '+919000599999', gender: 'MALE', status: 'ACTIVE', source: 'WALK_IN' },
    });

    expect((await reader.memberCounts(gymId, TODAY)).total).toBe(5);
    expect((await reader.members(gymId, TODAY, { limit: 50 })).map((m) => m.fullName)).not.toContain('Aaaa Stranger');
    // Teardown is in afterAll, so a failure above still cleans up.
  });



  /**
   * Somebody who filled the form and never paid is not a member yet (ADR-125).
   *
   * The owner found one in the Members list minutes after deleting sixteen records of
   * exactly that shape. These two are created last on purpose, so the counts the earlier
   * tests assert are the ones they were written against.
   */
  it('keeps people who never paid out of the register, and lets a payment bring them in', async () => {
    const unpaidId = `mem_it_mlist_${run}_06`;
    await prisma.member.create({
      data: { id: unpaidId, gymId, fullName: 'Ishita Unpaid', mobile: '+919000500006', gender: 'FEMALE', status: 'PENDING_PAYMENT', source: 'QR_NEW' },
    });

    const register = await reader.members(gymId, TODAY, { awaitingPayment: false, limit: 50 });
    expect(register.map((m) => m.fullName)).not.toContain('Ishita Unpaid');

    const waiting = await reader.members(gymId, TODAY, { awaitingPayment: true, limit: 50 });
    expect(waiting.map((m) => m.fullName)).toEqual(['Ishita Unpaid']);

    // Not asking is how the search box behaves: somebody ringing about their own
    // sign-up has to be findable by name.
    const everybody = await reader.members(gymId, TODAY, { limit: 50 });
    expect(everybody.map((m) => m.fullName)).toContain('Ishita Unpaid');

    expect(await reader.memberCounts(gymId, TODAY)).toMatchObject({ total: 5, awaitingPayment: 1 });

    /**
     * A desk that takes cash and moves on can leave the status behind, so the escape
     * hatch is the payment and not the column.
     */
    await prisma.payment.create({
      data: {
        gymId,
        memberId: unpaidId,
        amountPaise: 150000,
        status: 'PAID',
        method: 'CASH',
        paidAt: new Date('2026-09-30T04:00:00.000Z'),
      },
    });

    const afterPaying = await reader.members(gymId, TODAY, { awaitingPayment: false, limit: 50 });
    expect(afterPaying.map((m) => m.fullName)).toContain('Ishita Unpaid');
    expect(await reader.memberCounts(gymId, TODAY)).toMatchObject({ total: 6, awaitingPayment: 0 });
  });

  /**
   * U-3. The list was capped with no way past the cap, so these cover the paging that
   * replaced it — and the case that makes a naive cursor wrong.
   *
   * The sort is alphabetical, so a page boundary is a name, and **names are not unique
   * here**: this register has carried three members sharing one name and two sharing
   * another. A cursor on the name alone either skips the rest of a duplicate run
   * or serves it twice, and at a page boundary that silently loses a real member.
   */
  it('pages through every member exactly once, including duplicate names', async () => {
    // Three members sharing one name, straddling a page boundary of two.
    const duplicates = ['Zz Duplicate Name', 'Zz Duplicate Name', 'Zz Duplicate Name'];
    const ids: string[] = [];
    for (const [index, name] of duplicates.entries()) ids.push(await member(`dup${index}`, name, '2026-10-31'));

    const seen: string[] = [];
    let cursor: string | undefined;
    // Two at a time, so the duplicate run cannot sit wholly inside one page.
    for (let guard = 0; guard < 20; guard++) {
      const page = await reader.membersPage(gymId, TODAY, { limit: 2, ...(cursor === undefined ? {} : { cursor }) });
      seen.push(...page.rows.map((row) => row.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }

    // Every member once: no duplicates served twice, and none skipped at a boundary.
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of ids) expect(seen, `member ${id} was skipped`).toContain(id);

    const everyone = await reader.members(gymId, TODAY, { limit: 100 });
    expect(seen.sort()).toEqual(everyone.map((row) => row.id).sort());
  });

  it('stops offering a next page on the last one', async () => {
    const all = await reader.members(gymId, TODAY, { limit: 100 });
    const whole = await reader.membersPage(gymId, TODAY, { limit: 100 });

    expect(whole.rows).toHaveLength(all.length);
    // Exactly one page: there is nothing older to offer.
    expect(whole.nextCursor).toBeNull();
  });

  it('keeps the fee filter while paging', async () => {
    const first = await reader.membersPage(gymId, TODAY, { feeState: 'EXPIRED', limit: 1 });
    expect(first.rows.every((row) => row.feeState === 'EXPIRED')).toBe(true);

    if (first.nextCursor !== null) {
      const second = await reader.membersPage(gymId, TODAY, { feeState: 'EXPIRED', limit: 1, cursor: first.nextCursor });
      // A cursor must not widen the filter: the second page is still only expired members.
      expect(second.rows.every((row) => row.feeState === 'EXPIRED')).toBe(true);
      expect(second.rows.map((row) => row.id)).not.toEqual(first.rows.map((row) => row.id));
    }
  });

  /** A member erased between two pages must not strand the reader on an empty screen. */
  it('falls back to the first page for a cursor that no longer exists', async () => {
    const page = await reader.membersPage(gymId, TODAY, { limit: 3, cursor: 'mem_does_not_exist' });
    const first = await reader.membersPage(gymId, TODAY, { limit: 3 });

    expect(page.rows.map((row) => row.id)).toEqual(first.rows.map((row) => row.id));
  });
});

