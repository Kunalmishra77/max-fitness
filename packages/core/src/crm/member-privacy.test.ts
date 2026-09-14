import { beforeEach, describe, expect, it } from 'vitest';
import { fakeClockAt } from '../testing/builders';
import type { PutObjectRequest, StorageDriver, StoredObject } from '../ports/storage';
import {
  eraseMember,
  exportMemberData,
  type MemberExport,
  type MemberForErasure,
  type MemberPrivacyStore,
  type PrivacyAuditEntry,
} from './member-privacy';
import type { CrmActor } from './permissions';

/**
 * A member's rights over their data (privacy-and-dpdp-compliance §6; crm-module-spec §3).
 *
 * **Access:** the owner exports everything held about a member as JSON.
 * **Erasure:** the owner deletes it — photos, receipts and face data removed, the member
 * anonymised, messages and alerts scrubbed — while consents stay as minimal proof and
 * payments stay under the pseudonymous member code, because the accounts must still add
 * up. Both need the owner with a PIN entered a moment ago, and both are audited without
 * copying any of the personal data into the audit log.
 */

const clock = fakeClockAt('2026-09-14T11:00');
const owner: CrmActor = {
  staffUserId: 'staff_owner',
  gymId: 'gym_1',
  role: 'OWNER',
  elevatedUntil: new Date(clock.now().getTime() + 60_000),
  receptionMayTakePayments: true,
};
const ownerWithoutPin: CrmActor = { ...owner, elevatedUntil: null };
const reception: CrmActor = { ...owner, staffUserId: 'staff_rec', role: 'RECEPTION' };

const exported: MemberExport = {
  member: {
    id: 'mem_1',
    memberCode: 'MF-0007',
    fullName: 'सुरेश यादव',
    mobile: '+919876543210',
    email: null,
    dob: '1990-01-01',
    gender: 'MALE',
    language: 'hi',
    status: 'ACTIVE',
    source: 'WEBSITE',
    createdAt: '2026-01-05T05:30:00.000Z',
    whatsappOptIn: true,
    faceConsent: true,
    hasPhoto: true,
  },
  memberships: [{ startDate: '2026-09-01', endDate: '2026-09-30', durationMonths: 1, pricePaise: 150_000, status: 'CONFIRMED' }],
  payments: [{ amountPaise: 150_000, method: 'CASH', status: 'PAID', receiptNo: 'MF/2026-27/000012', paidAt: '2026-09-01T05:30:00.000Z' }],
  attendance: [{ date: '2026-09-12', method: 'MANUAL' }],
  consents: [{ type: 'PRIVACY', granted: true, noticeVersion: '1.0', channel: 'web_signup', createdAt: '2026-01-05T05:30:00.000Z', withdrawnAt: null }],
  messages: [{ purpose: 'RECEIPT', status: 'SENT', sentAt: '2026-09-01T05:31:00.000Z', text: 'आपकी रसीद MF/2026-27/000012' }],
  callTasks: [{ reason: 'EXPIRED_NOT_RENEWED', status: 'DONE', outcome: 'WILL_RENEW', note: null, createdAt: '2026-08-31T00:30:00.000Z' }],
  faceTemplates: { count: 1 },
};

class FakeStore implements MemberPrivacyStore {
  exportData: MemberExport | null = exported;
  member: MemberForErasure | null = { id: 'mem_1', memberCode: 'MF-0007', deletedAt: null };
  mediaKeys: string[] = ['selfies/one.jpg', 'receipts/two.pdf'];
  readonly steps: string[] = [];
  readonly audit: PrivacyAuditEntry[] = [];

  loadMemberExport(gymId: string, memberId: string) {
    return Promise.resolve(gymId === 'gym_1' && memberId === 'mem_1' ? this.exportData : null);
  }
  findMemberForErasure(gymId: string, memberId: string) {
    return Promise.resolve(gymId === 'gym_1' && memberId === 'mem_1' ? this.member : null);
  }
  anonymiseMember(memberId: string) {
    this.steps.push(`anonymise:${memberId}`);
    return Promise.resolve();
  }
  markMemberMediaDeleted(memberId: string) {
    this.steps.push(`media:${memberId}`);
    return Promise.resolve(this.mediaKeys);
  }
  deleteFaceData(memberId: string) {
    this.steps.push(`face:${memberId}`);
    return Promise.resolve(1);
  }
  scrubMessages(memberId: string) {
    this.steps.push(`messages:${memberId}`);
    return Promise.resolve();
  }
  scrubAlerts(memberId: string) {
    this.steps.push(`alerts:${memberId}`);
    return Promise.resolve();
  }
  closeCallTasks(memberId: string) {
    this.steps.push(`calls:${memberId}`);
    return Promise.resolve();
  }
  anonymiseConvertedLeads(memberId: string) {
    this.steps.push(`leads:${memberId}`);
    return Promise.resolve();
  }
  writeAudit(entry: PrivacyAuditEntry) {
    this.audit.push(entry);
    return Promise.resolve();
  }
}

class FakeStorage implements StorageDriver {
  readonly name = 'local' as const;
  readonly deleted: string[] = [];
  failing = new Set<string>();

  put(request: PutObjectRequest): Promise<StoredObject> {
    return Promise.resolve({ key: 'unused', sizeBytes: request.body.byteLength, sha256: 'a'.repeat(64), mimeType: request.mimeType });
  }
  get() {
    return Promise.reject(new Error('not used'));
  }
  delete(key: string) {
    if (this.failing.has(key)) return Promise.reject(new Error('storage unavailable'));
    this.deleted.push(key);
    return Promise.resolve();
  }
  exists() {
    return Promise.resolve(true);
  }
  signedUrl(key: string) {
    return Promise.resolve(`memory:${key}`);
  }
}

describe('exportMemberData', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  const run = (actor: CrmActor = owner, memberId = 'mem_1') => exportMemberData({ memberId }, { actor, clock, store });

  it('hands over everything held about the member, stamped with when it was exported', async () => {
    const result = await run();

    expect(result).toEqual({ format: 'max-fitness-member-export/1', exportedAt: clock.now().toISOString(), data: exported });
  });

  it('records who exported whom, and copies none of the personal data into the audit log', async () => {
    await run();

    expect(store.audit).toHaveLength(1);
    expect(store.audit[0]).toMatchObject({ action: 'member.export', entityType: 'Member', entityId: 'mem_1', actorId: 'staff_owner' });
    expect(JSON.stringify(store.audit)).not.toMatch(/सुरेश|9876543210|MF\/2026/);
  });

  it('refuses a member who does not exist here, or whose data has already been erased', async () => {
    await expect(run(owner, 'mem_elsewhere')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    store.exportData = null;
    await expect(run()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(store.audit).toEqual([]);
  });

  it('needs the owner, with a PIN entered a moment ago', async () => {
    await expect(run(ownerWithoutPin)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(run(reception)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('eraseMember', () => {
  let store: FakeStore;
  let storage: FakeStorage;
  beforeEach(() => {
    store = new FakeStore();
    storage = new FakeStorage();
  });

  const run = (input: { memberId?: string; reason?: string } = {}, actor: CrmActor = owner) =>
    eraseMember(
      { memberId: input.memberId ?? 'mem_1', reason: input.reason ?? 'सदस्य ने डेटा हटाने को कहा' },
      { actor, clock, uow: { transaction: (work) => work(store) }, storage },
    );

  it('anonymises the member and removes their photos, receipts, face data, message text, alerts, calls and enquiries', async () => {
    await expect(run()).resolves.toEqual({ memberId: 'mem_1', filesDeleted: 2, filesNotDeleted: [], faceTemplatesDeleted: 1 });

    expect(store.steps).toEqual([
      'anonymise:mem_1',
      'media:mem_1',
      'face:mem_1',
      'messages:mem_1',
      'alerts:mem_1',
      'calls:mem_1',
      'leads:mem_1',
    ]);
    expect(storage.deleted).toEqual(['selfies/one.jpg', 'receipts/two.pdf']);
  });

  it('records the erasure with its reason and the pseudonymous member code, and nothing personal', async () => {
    await run();

    expect(store.audit).toEqual([
      {
        gymId: 'gym_1',
        actorType: 'staff',
        actorId: 'staff_owner',
        action: 'member.erase',
        entityType: 'Member',
        entityId: 'mem_1',
        before: { memberCode: 'MF-0007' },
        // Written inside the transaction, so an erasure is never left unrecorded: it counts
        // the files due for removal, and the caller hears about any that would not go.
        after: { erased: true, reason: 'सदस्य ने डेटा हटाने को कहा', files: 2, faceTemplatesDeleted: 1 },
      },
    ]);
  });

  it('keeps the erasure when a stored file will not delete, and says which file is left', async () => {
    storage.failing.add('receipts/two.pdf');

    await expect(run()).resolves.toMatchObject({ filesDeleted: 1, filesNotDeleted: ['receipts/two.pdf'] });
    expect(store.steps).toContain('anonymise:mem_1');
  });

  it('needs a reason', async () => {
    await expect(run({ reason: '   ' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(store.steps).toEqual([]);
  });

  it('refuses a member who does not exist here, and one already erased', async () => {
    await expect(run({ memberId: 'mem_elsewhere' })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    store.member = { id: 'mem_1', memberCode: 'MF-0007', deletedAt: clock.now() };
    await expect(run()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(store.steps).toEqual([]);
    expect(storage.deleted).toEqual([]);
  });

  it('needs the owner, with a PIN entered a moment ago', async () => {
    await expect(run({}, ownerWithoutPin)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(run({}, reception)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(store.steps).toEqual([]);
  });
});
