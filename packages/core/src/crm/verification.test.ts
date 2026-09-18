import { beforeEach, describe, expect, it } from 'vitest';
import { istDate, type ISTDate } from '@mfp/shared';
import { fakeClockAt } from '../testing/builders';
import type { CrmActor } from './permissions';
import {
  approveVerification,
  rejectVerification,
  type DeclaredMembershipRecord,
  type LockedVerification,
  type VerificationAuditEntry,
  type VerificationStore,
} from './verification';

/**
 * The verify queue, "जाँचें" (crm-ux-blueprint §9; qr-onboarding-flow §4; BR-13; ADR-058).
 *
 * Approve makes the member ACTIVE with a declared membership ending on the chosen date —
 * the register's date when the member was imported, unless staff change it — and the
 * date the member gave stays on record. Reject needs a reason. A request is decided once.
 */

const clock = fakeClockAt('2026-09-17T11:00');
const reception: CrmActor = { staffUserId: 'staff_2', gymId: 'gym_1', role: 'RECEPTION', elevatedUntil: null, receptionMayTakePayments: true };
const trainer: CrmActor = { ...reception, staffUserId: 'staff_3', role: 'TRAINER' };

class FakeStore implements VerificationStore {
  request: LockedVerification | null = {
    id: 'ver_1',
    memberId: 'mem_1',
    status: 'PENDING',
    declaredPlanMonths: 3,
    declaredEndDate: istDate('2026-09-30'),
    declaredAmountPaise: 400_000,
    matchedImportMemberId: null,
  };
  member = { id: 'mem_1', memberCode: null as string | null, status: 'PENDING_VERIFICATION' };
  importMembership: { id: string; endDate: ISTDate } | null = null;
  readonly created: DeclaredMembershipRecord[] = [];
  readonly updated: Array<{ id: string; startDate: ISTDate | null; endDate: ISTDate; durationMonths: number | null }> = [];
  readonly activated: Array<{ memberId: string; memberCode: string }> = [];
  readonly decisions: Array<Record<string, unknown>> = [];
  readonly closed: string[] = [];
  readonly outbox: Array<{ type: string; dedupeKey: string; payload: Record<string, unknown> }> = [];
  readonly audit: VerificationAuditEntry[] = [];
  counter = 41;

  lockRequest() {
    return Promise.resolve(this.request);
  }
  getMember() {
    return Promise.resolve(this.member);
  }
  findDeclaredImportMembership() {
    return Promise.resolve(this.importMembership);
  }
  updateDeclaredMembership(id: string, values: { startDate: ISTDate | null; endDate: ISTDate; durationMonths: number | null }) {
    this.updated.push({ id, ...values });
    return Promise.resolve();
  }
  createDeclaredMembership(record: DeclaredMembershipRecord) {
    this.created.push(record);
    return Promise.resolve('ms_1');
  }
  nextCounterValue() {
    this.counter += 1;
    return Promise.resolve(this.counter);
  }
  activateMember(memberId: string, memberCode: string) {
    this.activated.push({ memberId, memberCode });
    return Promise.resolve();
  }
  decide(id: string, values: Record<string, unknown>) {
    this.decisions.push({ id, ...values });
    return Promise.resolve();
  }
  closeVerificationCalls(memberId: string) {
    this.closed.push(memberId);
    return Promise.resolve();
  }
  enqueueOutbox(event: { type: string; dedupeKey: string; payload: Record<string, unknown> }) {
    this.outbox.push({ type: event.type, dedupeKey: event.dedupeKey, payload: event.payload });
    return Promise.resolve();
  }
  writeAudit(entry: VerificationAuditEntry) {
    this.audit.push(entry);
    return Promise.resolve();
  }
}

describe('approveVerification', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });
  const approve = (input: { approvedEndDate?: string; planMonths?: 1 | 3 | 6 | 12 } = {}, actor = reception) =>
    approveVerification(
      {
        verificationId: 'ver_1',
        ...(input.approvedEndDate === undefined ? {} : { approvedEndDate: istDate(input.approvedEndDate) }),
        ...(input.planMonths === undefined ? {} : { planMonths: input.planMonths }),
      },
      { actor, clock, uow: { transaction: (work) => work(store) } },
    );

  it('activates a new member with a declared membership on the date they gave (BR-3.6)', async () => {
    const result = await approve();

    expect(result).toEqual({ memberId: 'mem_1', memberCode: 'MF-0042', startDate: '2026-07-01', endDate: '2026-09-30' });
    expect(store.created).toEqual([
      {
        gymId: 'gym_1',
        memberId: 'mem_1',
        durationMonths: 3,
        startDate: '2026-07-01',
        endDate: '2026-09-30',
        declaredEndDate: '2026-09-30',
        pricePaise: 400_000,
        createdById: 'staff_2',
      },
    ]);
    expect(store.activated).toEqual([{ memberId: 'mem_1', memberCode: 'MF-0042' }]);
    expect(store.decisions).toEqual([
      { id: 'ver_1', status: 'APPROVED', decidedById: 'staff_2', decidedAt: clock.now(), approvedEndDate: '2026-09-30' },
    ]);
    expect(store.closed).toEqual(['mem_1']);
    expect(store.outbox).toEqual([{ type: 'whatsapp.verification_approved', dedupeKey: 'verification-approved:ver_1', payload: { memberId: 'mem_1' } }]);
  });

  it('uses the corrected date and plan when staff change them, keeping the date the member gave (BR-13.2)', async () => {
    await approve({ approvedEndDate: '2026-09-28', planMonths: 1 });

    expect(store.created[0]).toMatchObject({ durationMonths: 1, startDate: '2026-08-29', endDate: '2026-09-28', declaredEndDate: '2026-09-30' });
    expect(store.audit[0]).toMatchObject({
      action: 'verification.approve',
      entityType: 'VerificationRequest',
      entityId: 'ver_1',
      after: { declaredEndDate: '2026-09-30', approvedEndDate: '2026-09-28', planMonths: 1 },
    });
  });

  it('moves the register membership to the chosen date for an imported member, and keeps the member code', async () => {
    store.request = { ...(store.request as LockedVerification), memberId: 'mem_imp', matchedImportMemberId: 'mem_imp' };
    store.member = { id: 'mem_imp', memberCode: 'MF-0007', status: 'ACTIVE' };
    store.importMembership = { id: 'ms_imp', endDate: istDate('2026-09-28') };

    const result = await approve({ approvedEndDate: '2026-09-28' });

    expect(result).toMatchObject({ memberCode: 'MF-0007', endDate: '2026-09-28' });
    expect(store.created).toEqual([]);
    // Same date as the register: nothing to move, only the plan length is recorded.
    expect(store.updated).toEqual([{ id: 'ms_imp', startDate: '2026-06-29', endDate: '2026-09-28', durationMonths: 3 }]);
    expect(store.activated).toEqual([{ memberId: 'mem_imp', memberCode: 'MF-0007' }]);
  });

  it('refuses a chosen date outside sixty days back to thirteen months ahead', async () => {
    await expect(approve({ approvedEndDate: '2026-07-18' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', meta: { field: 'approvedEndDate' } });
    expect(store.decisions).toEqual([]);
  });

  it('decides a request only once, and says so for an unknown one', async () => {
    store.request = { ...(store.request as LockedVerification), status: 'APPROVED' };
    await expect(approve()).rejects.toMatchObject({ code: 'CONFLICT' });
    store.request = null;
    await expect(approve()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('is for owner and reception, not trainers', async () => {
    await expect(approve({}, trainer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('rejectVerification', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });
  const reject = (reason: string, actor = reception) =>
    rejectVerification({ verificationId: 'ver_1', reason }, { actor, clock, uow: { transaction: (work) => work(store) } });

  it('records the reason and who decided, and leaves the member unverified', async () => {
    await reject('  रजिस्टर में नाम नहीं मिला  ');

    expect(store.decisions).toEqual([
      { id: 'ver_1', status: 'REJECTED', decidedById: 'staff_2', decidedAt: clock.now(), rejectReason: 'रजिस्टर में नाम नहीं मिला' },
    ]);
    expect(store.activated).toEqual([]);
    expect(store.created).toEqual([]);
    expect(store.closed).toEqual(['mem_1']);
    expect(store.audit[0]).toMatchObject({ action: 'verification.reject', after: { reason: 'रजिस्टर में नाम नहीं मिला' } });
  });

  it('needs a reason, and a pending request', async () => {
    await expect(reject('   ')).rejects.toMatchObject({ code: 'VALIDATION_FAILED', meta: { field: 'reason' } });
    store.request = { ...(store.request as LockedVerification), status: 'REJECTED' };
    await expect(reject('dup')).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(reject('x', trainer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
