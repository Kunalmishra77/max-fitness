import { describe, expect, it } from 'vitest';
import { RegistrationFieldsSchema, type E164Mobile } from '@mfp/shared';
import { DomainError } from '../errors';
import type { PutObjectRequest, StorageDriver, StoredObject } from '../ports/storage';
import { fakeClockAt } from '../testing/builders';
import { verifyToken } from '../tokens/signed-links';
import {
  REGISTRATION_TOKEN_TTL_SECONDS,
  registerMember,
  type ConsentRecord,
  type LeadConversion,
  type NewMemberRecord,
  type RegistrationDeps,
  type RegistrationStore,
  type SelfieMediaRecord,
} from './registration.service';

const SECRET = 'registration-test-secret-of-32-plus-chars';

class FakeStorage implements StorageDriver {
  readonly name = 'local' as const;
  readonly objects = new Map<string, PutObjectRequest>();
  readonly deleted: string[] = [];

  put(request: PutObjectRequest): Promise<StoredObject> {
    const key = `${request.prefix}/object-${this.objects.size + 1}`;
    this.objects.set(key, request);
    return Promise.resolve({ key, sizeBytes: request.body.byteLength, sha256: `sha-${key}`, mimeType: request.mimeType });
  }
  get(): Promise<Uint8Array> {
    return Promise.reject(new Error('not used'));
  }
  delete(key: string): Promise<void> {
    this.deleted.push(key);
    this.objects.delete(key);
    return Promise.resolve();
  }
  exists(key: string): Promise<boolean> {
    return Promise.resolve(this.objects.has(key));
  }
  signedUrl(key: string): Promise<string> {
    return Promise.resolve(`signed:${key}`);
  }
}

class FakeRegistrationStore implements RegistrationStore {
  readonly members: Array<NewMemberRecord & { id: string }> = [];
  readonly media: Array<SelfieMediaRecord & { id: string }> = [];
  readonly photos = new Map<string, string>();
  readonly consents: ConsentRecord[] = [];
  readonly conversions: LeadConversion[] = [];
  existingMatches = 0;

  convertLeadsForMobile(conversion: LeadConversion): Promise<number> {
    this.conversions.push(conversion);
    return Promise.resolve(1);
  }
  failConsents = false;

  countMembersWithMobileAndName(_gymId: string, _mobile: E164Mobile, _fullName: string): Promise<number> {
    return Promise.resolve(this.existingMatches);
  }
  createMember(record: NewMemberRecord): Promise<string> {
    const id = `mem_${this.members.length + 1}`;
    this.members.push({ ...record, id });
    return Promise.resolve(id);
  }
  createSelfieMedia(record: SelfieMediaRecord): Promise<string> {
    const id = `media_${this.media.length + 1}`;
    this.media.push({ ...record, id });
    return Promise.resolve(id);
  }
  setMemberPhoto(memberId: string, mediaId: string): Promise<void> {
    this.photos.set(memberId, mediaId);
    return Promise.resolve();
  }
  createConsents(records: readonly ConsentRecord[]): Promise<void> {
    if (this.failConsents) return Promise.reject(new Error('database unavailable'));
    this.consents.push(...records);
    return Promise.resolve();
  }
}

const baseFields = {
  fullName: 'Priya Sharma',
  mobile: '9876543210',
  email: 'priya@example.com',
  dob: '1998-04-12',
  gender: 'FEMALE',
  language: 'hi',
  consents: { terms: true, privacy: true, whatsappUpdates: true, faceAttendance: true },
  noticeVersion: '1.0',
};

const selfie = { body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), width: 720, height: 720 };

function setup(overrides: Partial<typeof baseFields> = {}) {
  const store = new FakeRegistrationStore();
  const storage = new FakeStorage();
  const clock = fakeClockAt('2026-09-11T10:00');
  const deps: RegistrationDeps = {
    clock,
    uow: { transaction: (work) => work(store) },
    storage,
    tokenSecret: SECRET,
    gymId: 'gym_1',
    minAge: 16,
    channel: 'web_signup',
    source: 'WEBSITE',
    ipHash: 'iphash',
    userAgent: 'test-agent',
  };
  const fields = RegistrationFieldsSchema.parse({ ...baseFields, ...overrides });
  return { store, storage, clock, deps, fields };
}

describe('registerMember', () => {
  it('turns an enquiry from the same number in the last 60 days into this member (BR-10.2)', async () => {
    const { store, clock, deps, fields } = setup();
    await registerMember(fields, selfie, deps);

    expect(store.conversions).toEqual([
      { gymId: 'gym_1', mobile: '+919876543210', since: new Date(clock.now().getTime() - 60 * 86_400_000), memberId: 'mem_1', at: clock.now() },
    ]);
  });

  it('converts nothing when the registration is refused', async () => {
    const { store, deps } = setup();
    const underAge = RegistrationFieldsSchema.parse({ ...baseFields, dob: '2015-01-01' });
    await expect(registerMember(underAge, selfie, deps)).rejects.toBeInstanceOf(DomainError);
    expect(store.conversions).toEqual([]);
  });

  it('creates a pending member with their selfie and consents, and returns a registration token', async () => {
    const { store, storage, clock, deps, fields } = setup();

    const result = await registerMember(fields, selfie, deps);

    expect(result).toMatchObject({ memberId: 'mem_1', isMinor: false, possibleDuplicate: false });
    expect(store.members[0]).toEqual({
      id: 'mem_1',
      gymId: 'gym_1',
      fullName: 'Priya Sharma',
      mobile: '+919876543210',
      email: 'priya@example.com',
      dob: '1998-04-12',
      gender: 'FEMALE',
      language: 'hi',
      status: 'PENDING_PAYMENT',
      source: 'WEBSITE',
      // Nobody at the desk typed this one in.
      createdById: null,
      isMinor: false,
      whatsappOptIn: true,
      faceConsent: true,
    });

    const [stored] = [...storage.objects.entries()];
    expect(stored?.[1]).toMatchObject({ prefix: 'selfies', mimeType: 'image/jpeg' });
    expect(store.media[0]).toMatchObject({ gymId: 'gym_1', memberId: 'mem_1', width: 720, height: 720 });
    expect(store.media[0]!.stored.key).toBe(stored?.[0]);
    expect(store.photos.get('mem_1')).toBe('media_1');

    expect(store.consents.map((c) => [c.type, c.granted])).toEqual([
      ['TERMS', true],
      ['PRIVACY', true],
      ['WHATSAPP_UPDATES', true],
      ['FACE_ATTENDANCE', true],
    ]);
    expect(store.consents[0]).toMatchObject({
      gymId: 'gym_1',
      memberId: 'mem_1',
      noticeVersion: '1.0',
      channel: 'web_signup',
      ipHash: 'iphash',
      userAgent: 'test-agent',
    });

    const token = verifyToken({ token: result.registrationToken, purpose: 'registration', secret: SECRET, clock });
    expect(token).toEqual({
      valid: true,
      subject: 'mem_1',
      expiresAt: Math.floor(clock.now().getTime() / 1000) + REGISTRATION_TOKEN_TTL_SECONDS,
    });
    expect(REGISTRATION_TOKEN_TTL_SECONDS).toBe(48 * 3600);
  });

  it('flags a minor and records face attendance as not granted', async () => {
    const { store, deps, fields } = setup({ dob: '2009-01-01' });

    const result = await registerMember(fields, selfie, deps);

    expect(result.isMinor).toBe(true);
    expect(store.members[0]).toMatchObject({ isMinor: true, faceConsent: false });
    expect(store.consents).toContainEqual(expect.objectContaining({ type: 'FACE_ATTENDANCE', granted: false }));
  });

  it('refuses someone under the minimum age before storing anything', async () => {
    const { store, storage, deps, fields } = setup({ dob: '2012-01-01' });

    const error = await registerMember(fields, selfie, deps).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('UNDER_MINIMUM_AGE');
    expect(storage.objects.size).toBe(0);
    expect(store.members).toHaveLength(0);
  });

  it('hints at a possible duplicate without blocking the registration', async () => {
    const { store, deps, fields } = setup();
    store.existingMatches = 1;

    const result = await registerMember(fields, selfie, deps);

    expect(result.possibleDuplicate).toBe(true);
    expect(store.members).toHaveLength(1);
  });

  it('removes the stored selfie when the database write fails', async () => {
    const { store, storage, deps, fields } = setup();
    store.failConsents = true;

    await expect(registerMember(fields, selfie, deps)).rejects.toThrow('database unavailable');
    expect(storage.objects.size).toBe(0);
    expect(storage.deleted).toEqual(['selfies/object-1']);
  });
});
