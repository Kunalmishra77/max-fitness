import { beforeEach, describe, expect, it } from 'vitest';
import { RegistrationFieldsSchema, istDate, type E164Mobile } from '@mfp/shared';
import type { PutObjectRequest, StorageDriver, StoredObject } from '../ports/storage';
import { fakeClockAt } from '../testing/builders';
import {
  submitExistingMember,
  type ExistingMemberStore,
  type QrMemberRecord,
  type VerificationRequestRecord,
} from './existing-member';

/**
 * An existing member scans the reception QR (PRD QR-02…04; qr-onboarding-flow §3; BR-3.6, BR-13; ADR-058).
 *
 * They say who they are and until when their fees are paid. Nothing is trusted yet:
 * staff approve it in the verify queue against the reference code the member shows.
 * If the paper register already has them, the submission joins that record rather than
 * making a second member; if they scan twice, they get the same reference back.
 */

const clock = fakeClockAt('2026-09-17T10:00');

const fields = RegistrationFieldsSchema.parse({
  fullName: 'Sanjay Tomar',
  mobile: '9876543210',
  dob: '1984-02-14',
  gender: 'MALE',
  language: 'hi',
  consents: { terms: true, privacy: true, whatsappUpdates: true, faceAttendance: true },
  noticeVersion: '1.0',
});
const selfie = { body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 720, height: 720 };

class MemoryStorage implements StorageDriver {
  readonly name = 'local' as const;
  readonly objects = new Map<string, Uint8Array>();
  deleted: string[] = [];
  put(request: PutObjectRequest): Promise<StoredObject> {
    const key = `${request.prefix}/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA${this.objects.size}`;
    this.objects.set(key, request.body);
    return Promise.resolve({ key, sizeBytes: request.body.byteLength, sha256: 'a'.repeat(64), mimeType: request.mimeType });
  }
  get = () => Promise.reject(new Error('unused'));
  delete(key: string) {
    this.deleted.push(key);
    this.objects.delete(key);
    return Promise.resolve();
  }
  exists = () => Promise.resolve(false);
  signedUrl = () => Promise.resolve('');
}

class FakeStore implements ExistingMemberStore {
  imported: { id: string } | null = null;
  pending: { referenceCode: string } | null = null;
  taken = new Set<string>();
  readonly members: QrMemberRecord[] = [];
  readonly confirmed: Array<{ memberId: string; whatsappOptIn: boolean; faceConsent: boolean }> = [];
  readonly photos: Array<{ memberId: string; mediaId: string }> = [];
  readonly consents: Array<{ memberId: string; type: string; channel: string }> = [];
  readonly requests: VerificationRequestRecord[] = [];
  readonly alerts: Array<{ memberId: string; params: Record<string, string> }> = [];

  /** Register entries by id, each with its number: what a proven number may claim. */
  byId = new Map<string, E164Mobile>();
  findImportedMember() {
    return Promise.resolve(this.imported);
  }
  findImportedMemberById(_gymId: string, mobile: E164Mobile, memberId: string) {
    return Promise.resolve(this.byId.get(memberId) === mobile ? { id: memberId } : null);
  }
  findPendingRequest() {
    return Promise.resolve(this.pending);
  }
  referenceCodeTaken(_gymId: string, code: string) {
    return Promise.resolve(this.taken.has(code));
  }
  createMember(record: QrMemberRecord) {
    this.members.push(record);
    return Promise.resolve('mem_new');
  }
  confirmImportedMember(memberId: string, values: { whatsappOptIn: boolean; faceConsent: boolean }) {
    this.confirmed.push({ memberId, ...values });
    return Promise.resolve();
  }
  createSelfieMedia() {
    return Promise.resolve('media_1');
  }
  readonly govIdMedia: Array<{ memberId: string; label: string; key: string }> = [];
  createGovIdMedia(record: { memberId: string; label: string; stored: { key: string } }) {
    this.govIdMedia.push({ memberId: record.memberId, label: record.label, key: record.stored.key });
    return Promise.resolve(`media_${this.govIdMedia.length + 1}`);
  }
  setMemberPhoto(memberId: string, mediaId: string) {
    this.photos.push({ memberId, mediaId });
    return Promise.resolve();
  }
  createConsents(records: ReadonlyArray<{ memberId: string; type: string; channel: string }>) {
    this.consents.push(...records.map(({ memberId, type, channel }) => ({ memberId, type, channel })));
    return Promise.resolve();
  }
  createVerificationRequest(record: VerificationRequestRecord) {
    this.requests.push(record);
    return Promise.resolve('ver_1');
  }
  createAlert(alert: { memberId: string; params: Record<string, string> }) {
    this.alerts.push({ memberId: alert.memberId, params: alert.params });
    return Promise.resolve();
  }
}

describe('submitExistingMember', () => {
  let store: FakeStore;
  let storage: MemoryStorage;
  let digits: number[];

  beforeEach(() => {
    store = new FakeStore();
    storage = new MemoryStorage();
    digits = [4821, 1234];
  });

  const submit = (
    declared: Partial<{
      planMonths: 1 | 3 | 6 | 12 | null;
      endDate: string;
      amountPaise: number | null;
      claimedMemberId: string;
      joinedOn: string | null;
      govId: { type: 'AADHAAR' | 'PAN' | 'DL' | 'VOTER'; images: Array<{ side: 'FRONT' | 'BACK'; body: Uint8Array; width: number; height: number }> } | null;
    }> = {},
  ) =>
    submitExistingMember(
      {
        fields,
        selfie,
        declaredPlanMonths: declared.planMonths === undefined ? 3 : declared.planMonths,
        declaredEndDate: istDate(declared.endDate ?? '2026-09-30'),
        declaredAmountPaise: declared.amountPaise === undefined ? 400_000 : declared.amountPaise,
        joinedOn: declared.joinedOn === undefined ? null : declared.joinedOn === null ? null : istDate(declared.joinedOn),
        govId: declared.govId === undefined ? null : declared.govId,
        ...(declared.claimedMemberId === undefined ? {} : { claimedMemberId: declared.claimedMemberId }),
      },
      {
        clock,
        uow: { transaction: (work) => work(store) },
        storage,
        gymId: 'gym_1',
        minAge: 16,
        ipHash: 'hash',
        userAgent: 'test',
        randomCode: () => digits.shift() ?? 9999,
      },
    );

  it('creates a member waiting for verification, with the photo, consents, a request and an alert', async () => {
    const result = await submit();

    expect(result).toEqual({ referenceCode: 'Q-4821', matchedExisting: false });
    expect(store.members).toEqual([
      expect.objectContaining({
        gymId: 'gym_1',
        fullName: 'Sanjay Tomar',
        mobile: '+919876543210' as E164Mobile,
        status: 'PENDING_VERIFICATION',
        source: 'QR_EXISTING',
        whatsappOptIn: true,
        faceConsent: true,
        isMinor: false,
      }),
    ]);
    expect(store.photos).toEqual([{ memberId: 'mem_new', mediaId: 'media_1' }]);
    expect(store.consents.every((consent) => consent.memberId === 'mem_new' && consent.channel === 'qr')).toBe(true);
    expect(store.requests).toEqual([
      {
        gymId: 'gym_1',
        memberId: 'mem_new',
        referenceCode: 'Q-4821',
        declaredPlanMonths: 3,
        declaredEndDate: '2026-09-30',
        declaredAmountPaise: 400_000,
        govIdType: null,
        matchedImportMemberId: null,
      },
    ]);
    // The alert names the reference, never the person.
    expect(store.alerts).toEqual([{ memberId: 'mem_new', params: { referenceCode: 'Q-4821' } }]);
  });

  it('with a number proven by OTP, joins the register entry the member picked, however the name is spelled', async () => {
    store.byId.set('mem_register', fields.mobile);

    const result = await submit({ claimedMemberId: 'mem_register' });

    expect(result).toEqual({ referenceCode: 'Q-4821', matchedExisting: true });
    expect(store.members).toEqual([]);
    expect(store.requests[0]?.matchedImportMemberId).toBe('mem_register');
  });

  it('ignores a picked entry that belongs to another number', async () => {
    store.byId.set('mem_someone_else', '+919811111111' as E164Mobile);

    const result = await submit({ claimedMemberId: 'mem_someone_else' });

    expect(result.matchedExisting).toBe(false);
    expect(store.members).toHaveLength(1);
  });

  it('joins the register record when the same person was imported, instead of making a second member', async () => {
    store.imported = { id: 'mem_imported' };

    const result = await submit();

    expect(result).toEqual({ referenceCode: 'Q-4821', matchedExisting: true });
    expect(store.members).toEqual([]);
    expect(store.confirmed).toEqual([{ memberId: 'mem_imported', whatsappOptIn: true, faceConsent: true }]);
    expect(store.photos).toEqual([{ memberId: 'mem_imported', mediaId: 'media_1' }]);
    expect(store.requests[0]).toMatchObject({ memberId: 'mem_imported', matchedImportMemberId: 'mem_imported' });
  });

  it('hands back the same reference when the person scans again, and keeps no second photo', async () => {
    store.pending = { referenceCode: 'Q-7777' };

    const result = await submit();

    expect(result).toEqual({ referenceCode: 'Q-7777', matchedExisting: false });
    expect(store.members).toEqual([]);
    expect(store.requests).toEqual([]);
    expect(storage.objects.size).toBe(0);
    expect(storage.deleted).toHaveLength(1);
  });

  it('draws a new random code when one is already in use', async () => {
    store.taken.add('Q-4821');
    expect(await submit()).toMatchObject({ referenceCode: 'Q-1234' });
  });

  it('takes a fee date that ran out long ago, because that member is the one worth getting back', async () => {
    // Six months lapsed used to be refused outright (ADR-075). Staff check every one
    // of these at the desk, so the form's job is to let them through, not to judge.
    await expect(submit({ endDate: '2026-03-01' })).resolves.toBeDefined();
    store = new FakeStore();
    digits = [5555];
    await expect(submit({ endDate: '2024-01-15' })).resolves.toBeDefined();
  });

  it('still refuses a date that cannot be a fee date at all', async () => {
    // Thirteen months ahead, because no plan runs longer; and further back than any
    // register the gym still has, which is a typo rather than a member.
    for (const endDate of ['2027-10-18', '2020-01-01']) {
      store = new FakeStore();
      await expect(submit({ endDate })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', meta: { field: 'declaredEndDate' } });
    }
  });

  it('refuses an amount that is not whole rupees, and stores nothing when refusing', async () => {
    await expect(submit({ amountPaise: 400_050 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', meta: { field: 'declaredAmountPaise' } });
    await expect(submit({ amountPaise: -100 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(storage.objects.size).toBe(0);
    expect(store.requests).toEqual([]);
  });

  it('allows an unknown plan and an unknown amount', async () => {
    await submit({ planMonths: null, amountPaise: null });
    expect(store.requests[0]).toMatchObject({ declaredPlanMonths: null, declaredAmountPaise: null });
  });

  it('removes the photo again when the database write fails', async () => {
    const failing = { transaction: () => Promise.reject(new Error('db down')) };
    await expect(
      submitExistingMember(
        { fields, selfie, declaredPlanMonths: 3, declaredEndDate: istDate('2026-09-30'), declaredAmountPaise: null, joinedOn: null, govId: null },
        { clock, uow: failing, storage, gymId: 'gym_1', minAge: 16, ipHash: null, userAgent: null },
      ),
    ).rejects.toThrow('db down');
    expect(storage.objects.size).toBe(0);
  });

  // ── What the client asked the QR to collect as well (ADR-074) ──────────────

  const card = (side: 'FRONT' | 'BACK') => ({ side, body: new Uint8Array([1, 2, 3]), width: 900, height: 600 });

  it('keeps the joining date when the member remembers it', async () => {
    await submit({ joinedOn: '2019-04-15' });

    expect(store.members[0]).toMatchObject({ joinedOn: '2019-04-15' });
  });

  it('does not insist on a joining date, because plenty of members will not know', async () => {
    await submit({ joinedOn: null });

    expect(store.members[0]).toMatchObject({ joinedOn: null });
  });

  it('stores both sides of an Aadhaar as pictures, and no number anywhere', async () => {
    await submit({ govId: { type: 'AADHAAR', images: [card('FRONT'), card('BACK')] } });

    expect(store.govIdMedia.map((m) => m.label)).toEqual(['aadhaar-front', 'aadhaar-back']);
    // The request records which card it was, and nothing else about it. There is no
    // field anywhere for the number — that part is a guarantee of the types, not of
    // this assertion — so what is stored is a label and a storage key.
    expect(store.requests[0]).toMatchObject({ govIdType: 'AADHAAR' });
    expect(Object.keys(store.govIdMedia[0] ?? {}).sort()).toEqual(['key', 'label', 'memberId']);
  });

  it('stores the one side a PAN card has', async () => {
    await submit({ govId: { type: 'PAN', images: [card('FRONT')] } });

    expect(store.govIdMedia.map((m) => m.label)).toEqual(['pan-front']);
  });

  it('refuses an Aadhaar missing its back, and stores nothing at all', async () => {
    await expect(submit({ govId: { type: 'AADHAAR', images: [card('FRONT')] } })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      meta: { field: 'govId' },
    });

    expect(storage.objects.size).toBe(0);
    expect(store.members).toEqual([]);
    expect(store.requests).toEqual([]);
  });

  it('takes the ID pictures away again when the database write fails', async () => {
    // The selfie was already cleaned up on failure; the ID photographs are more
    // sensitive still, and must not be the thing left behind in the bucket.
    const failing = { transaction: () => Promise.reject(new Error('db down')) };
    await expect(
      submitExistingMember(
        {
          fields,
          selfie,
          declaredPlanMonths: 3,
          declaredEndDate: istDate('2026-09-30'),
          declaredAmountPaise: null,
          joinedOn: null,
          govId: { type: 'AADHAAR', images: [card('FRONT'), card('BACK')] },
        },
        { clock, uow: failing, storage, gymId: 'gym_1', minAge: 16, ipHash: null, userAgent: null },
      ),
    ).rejects.toThrow('db down');

    expect(storage.objects.size).toBe(0);
  });

  it('still works for a member who brought no ID at all', async () => {
    await submit({ govId: null });

    expect(store.govIdMedia).toEqual([]);
    expect(store.requests[0]).toMatchObject({ govIdType: null });
  });
});
