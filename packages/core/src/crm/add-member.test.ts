import { beforeEach, describe, expect, it } from 'vitest';
import { RegistrationFieldsSchema } from '@mfp/shared';
import { fakeClockAt } from '../testing/builders';
import type { PutObjectRequest, StorageDriver, StoredObject } from '../ports/storage';
import type { ConsentRecord, LeadConversion, NewMemberRecord, RegistrationStore, SelfieMediaRecord } from '../signup/registration.service';
import type { CrmActor } from './permissions';
import { registerAtDesk } from './add-member';

/**
 * Adding a member at the desk (crm-ux-blueprint §7; PRD SU-02; BR-12).
 *
 * The same person, the same consents and the same age rules as the website — only the
 * photo is optional, because a camera that will not open must not stop someone joining,
 * and the staff member who took the details is recorded on the member and on every
 * consent row.
 */

const owner: CrmActor = { staffUserId: 'staff_1', gymId: 'gym_1', role: 'OWNER', elevatedUntil: null, receptionMayTakePayments: true };
const reception: CrmActor = { ...owner, staffUserId: 'staff_2', role: 'RECEPTION' };
const trainer: CrmActor = { ...owner, staffUserId: 'staff_3', role: 'TRAINER' };

const fields = (overrides: Record<string, unknown> = {}) =>
  RegistrationFieldsSchema.parse({
    fullName: 'सुरेश यादव',
    mobile: '9876543210',
    dob: '1995-05-05',
    gender: 'MALE',
    language: 'hi',
    consents: { terms: true, privacy: true, whatsappUpdates: true, faceAttendance: true },
    noticeVersion: '1.0',
    ...overrides,
  });

const selfie = { body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 480, height: 640 };

class FakeStore implements RegistrationStore {
  duplicates = 0;
  readonly members: NewMemberRecord[] = [];
  readonly media: SelfieMediaRecord[] = [];
  readonly photos: Array<{ memberId: string; mediaId: string }> = [];
  readonly consents: ConsentRecord[] = [];
  readonly conversions: LeadConversion[] = [];

  convertLeadsForMobile(conversion: LeadConversion) {
    this.conversions.push(conversion);
    return Promise.resolve(1);
  }

  countMembersWithMobileAndName() {
    return Promise.resolve(this.duplicates);
  }
  createMember(record: NewMemberRecord) {
    this.members.push(record);
    return Promise.resolve('mem_1');
  }
  createSelfieMedia(record: SelfieMediaRecord) {
    this.media.push(record);
    return Promise.resolve('media_1');
  }
  setMemberPhoto(memberId: string, mediaId: string) {
    this.photos.push({ memberId, mediaId });
    return Promise.resolve();
  }
  createConsents(records: readonly ConsentRecord[]) {
    this.consents.push(...records);
    return Promise.resolve();
  }
}

class FakeStorage implements StorageDriver {
  readonly name = 'local' as const;
  readonly puts: PutObjectRequest[] = [];
  readonly deleted: string[] = [];

  put(request: PutObjectRequest): Promise<StoredObject> {
    this.puts.push(request);
    return Promise.resolve({ key: 'selfies/one.jpg', sizeBytes: request.body.byteLength, sha256: 'a'.repeat(64), mimeType: request.mimeType });
  }
  get() {
    return Promise.reject(new Error('not used'));
  }
  delete(key: string) {
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

describe('registerAtDesk', () => {
  let store: FakeStore;
  let storage: FakeStorage;
  const clock = fakeClockAt('2026-09-12T11:30');

  beforeEach(() => {
    store = new FakeStore();
    storage = new FakeStorage();
  });

  const add = (input: Parameters<typeof registerAtDesk>[0], actor: CrmActor = reception) =>
    registerAtDesk(input, { actor, clock, uow: { transaction: (work) => work(store) }, storage, minAge: 16 });

  it('creates a walk-in member and records who took the details', async () => {
    const result = await add({ fields: fields() });

    expect(result).toEqual({ memberId: 'mem_1', isMinor: false, possibleDuplicate: false });
    expect(store.members[0]).toMatchObject({
      gymId: 'gym_1',
      fullName: 'सुरेश यादव',
      mobile: '+919876543210',
      status: 'PENDING_PAYMENT',
      source: 'WALK_IN',
      createdById: 'staff_2',
      whatsappOptIn: true,
      faceConsent: true,
    });
  });

  it('records every consent against the desk and the staff member who took it', async () => {
    await add({ fields: fields() });

    expect(store.consents.map((row) => [row.type, row.granted])).toEqual([
      ['TERMS', true],
      ['PRIVACY', true],
      ['WHATSAPP_UPDATES', true],
      ['FACE_ATTENDANCE', true],
    ]);
    expect(store.consents[0]).toMatchObject({ channel: 'crm_desk', recordedById: 'staff_2', noticeVersion: '1.0', ipHash: null, userAgent: null });
  });

  it('joins someone without a photo, because a camera that will not open must not stop them', async () => {
    await add({ fields: fields() });

    expect(storage.puts).toEqual([]);
    expect(store.media).toEqual([]);
    expect(store.photos).toEqual([]);
  });

  it('stores the photo when one was taken', async () => {
    await add({ fields: fields(), selfie });

    expect(storage.puts).toHaveLength(1);
    expect(store.media[0]).toMatchObject({ gymId: 'gym_1', memberId: 'mem_1', width: 480, height: 640 });
    expect(store.photos).toEqual([{ memberId: 'mem_1', mediaId: 'media_1' }]);
  });

  it('turns an enquiry from the same number into this member — the desk is where most enquiries end up joining (BR-10.2)', async () => {
    await add({ fields: fields() });

    expect(store.conversions).toEqual([
      { gymId: 'gym_1', mobile: '+919876543210', since: new Date(clock.now().getTime() - 60 * 86_400_000), memberId: 'mem_1', at: clock.now() },
    ]);
  });

  it('refuses a trainer', async () => {
    await expect(add({ fields: fields() }, trainer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(store.members).toEqual([]);
  });

  it('refuses someone under the minimum age, and keeps no photo of them', async () => {
    await expect(add({ fields: fields({ dob: '2015-05-05' }), selfie })).rejects.toMatchObject({ code: 'UNDER_MINIMUM_AGE' });

    expect(storage.puts).toEqual([]);
    expect(store.members).toEqual([]);
  });

  it('keeps face attendance off for a minor, whatever was ticked (BR-12.2)', async () => {
    const result = await add({ fields: fields({ dob: '2010-05-05' }) });

    expect(result.isMinor).toBe(true);
    expect(store.members[0]).toMatchObject({ isMinor: true, faceConsent: false });
    expect(store.consents.find((row) => row.type === 'FACE_ATTENDANCE')).toMatchObject({ granted: false });
  });

  it('flags a possible duplicate without refusing: families share a number', async () => {
    store.duplicates = 1;
    await expect(add({ fields: fields() })).resolves.toMatchObject({ memberId: 'mem_1', possibleDuplicate: true });
  });

  it('deletes the stored photo when the transaction fails, leaving nothing behind', async () => {
    const failing = { transaction: () => Promise.reject(new Error('database gone')) };
    await expect(
      registerAtDesk({ fields: fields(), selfie }, { actor: owner, clock, uow: failing, storage, minAge: 16 }),
    ).rejects.toThrow('database gone');

    expect(storage.deleted).toEqual(['selfies/one.jpg']);
  });
});
