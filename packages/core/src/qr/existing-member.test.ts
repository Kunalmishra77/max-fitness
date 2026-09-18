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

  findImportedMember() {
    return Promise.resolve(this.imported);
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

  const submit = (declared: Partial<{ planMonths: 1 | 3 | 6 | 12 | null; endDate: string; amountPaise: number | null }> = {}) =>
    submitExistingMember(
      {
        fields,
        selfie,
        declaredPlanMonths: declared.planMonths === undefined ? 3 : declared.planMonths,
        declaredEndDate: istDate(declared.endDate ?? '2026-09-30'),
        declaredAmountPaise: declared.amountPaise === undefined ? 400_000 : declared.amountPaise,
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
        matchedImportMemberId: null,
      },
    ]);
    // The alert names the reference, never the person.
    expect(store.alerts).toEqual([{ memberId: 'mem_new', params: { referenceCode: 'Q-4821' } }]);
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

  it('accepts a month-end date from sixty days ago to thirteen months ahead, and nothing else', async () => {
    await expect(submit({ endDate: '2026-07-19' })).resolves.toBeDefined();
    store = new FakeStore();
    digits = [5555];
    await expect(submit({ endDate: '2027-10-17' })).resolves.toBeDefined();

    for (const endDate of ['2026-07-18', '2027-10-18']) {
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
        { fields, selfie, declaredPlanMonths: 3, declaredEndDate: istDate('2026-09-30'), declaredAmountPaise: null },
        { clock, uow: failing, storage, gymId: 'gym_1', minAge: 16, ipHash: null, userAgent: null },
      ),
    ).rejects.toThrow('db down');
    expect(storage.objects.size).toBe(0);
  });
});
