import { describe, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import { DomainError } from '../errors';
import { fakeClockAt } from '../testing/builders';
import type { CrmActor } from './permissions';
import { editMember, type MemberEditStore, type MemberEditValues, type MemberForEdit } from './edit-member';

/**
 * Correcting a member's details at the desk (crm-ux-blueprint §5).
 *
 * The register was typed by whoever was at the counter, and QR arrivals type their own
 * details on a phone — so a wrong number, a misspelt name or a missing date of birth is
 * normal, and the desk must be able to fix it without deleting anybody.
 *
 * What it must not do: resurrect an erased member, let a trainer edit anyone, or write
 * the member's own details into the audit log.
 */

const owner: CrmActor = { staffUserId: 'staff_1', gymId: 'gym_1', role: 'OWNER', elevatedUntil: null, receptionMayTakePayments: true };
const reception: CrmActor = { ...owner, staffUserId: 'staff_2', role: 'RECEPTION' };
const trainer: CrmActor = { ...owner, staffUserId: 'staff_3', role: 'TRAINER' };
const clock = fakeClockAt('2026-10-01T05:00:00Z');

const onFile: MemberForEdit = {
  id: 'mem_1',
  fullName: 'सुरेश यादव',
  mobile: '+919876543210',
  email: null,
  dob: istDate('1995-05-05'),
  gender: 'MALE',
  language: 'hi',
  trainingSlot: 'MORNING',
  joinedOn: null,
  notes: null,
  whatsappOptIn: false,
  deletedAt: null,
};

const values = (overrides: Partial<MemberEditValues> = {}): MemberEditValues => ({
  fullName: onFile.fullName,
  mobile: onFile.mobile,
  email: onFile.email,
  dob: onFile.dob,
  gender: onFile.gender,
  language: onFile.language,
  trainingSlot: onFile.trainingSlot,
  joinedOn: onFile.joinedOn,
  notes: onFile.notes,
  whatsappOptIn: onFile.whatsappOptIn,
  ...overrides,
});

class FakeStore implements MemberEditStore {
  member: MemberForEdit | null = onFile;
  othersOnThatMobile = 0;
  readonly saved: Array<{ memberId: string; values: MemberEditValues }> = [];
  readonly audits: unknown[] = [];

  findMemberForEdit(_gymId: string, memberId: string) {
    return Promise.resolve(this.member !== null && this.member.id === memberId ? this.member : null);
  }
  countOtherMembersWithMobile() {
    return Promise.resolve(this.othersOnThatMobile);
  }
  updateMember(memberId: string, next: MemberEditValues) {
    this.saved.push({ memberId, values: next });
    return Promise.resolve();
  }
  writeAudit(entry: unknown) {
    this.audits.push(entry);
    return Promise.resolve();
  }
}

const deps = (store: FakeStore, actor: CrmActor = owner) => ({
  actor,
  clock,
  uow: { transaction: <T>(work: (s: MemberEditStore) => Promise<T>) => work(store) },
});

describe('editMember', () => {
  it('saves the changed details and names only the fields that moved', async () => {
    const store = new FakeStore();

    const result = await editMember({ memberId: 'mem_1', values: values({ mobile: '+919000000001', email: 'suresh@example.com' }) }, deps(store));

    expect(result.changed).toEqual(['mobile', 'email']);
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]?.values.mobile).toBe('+919000000001');
    expect(store.saved[0]?.values.fullName).toBe('सुरेश यादव');
  });

  it('writes nothing at all when the desk saves the form unchanged', async () => {
    const store = new FakeStore();

    const result = await editMember({ memberId: 'mem_1', values: values() }, deps(store));

    expect(result.changed).toEqual([]);
    expect(store.saved).toEqual([]);
    expect(store.audits).toEqual([]);
  });

  it('keeps the member out of the audit log, recording which fields changed and nothing more', async () => {
    const store = new FakeStore();

    await editMember({ memberId: 'mem_1', values: values({ fullName: 'सुरेश कुमार यादव', mobile: '+919000000001' }) }, deps(store));

    const written = JSON.stringify(store.audits);
    expect(written).toContain('fullName');
    expect(written).not.toContain('सुरेश');
    expect(written).not.toContain('9000000001');
    expect(written).not.toContain('9876543210');
  });

  it('tells the desk when another member already has that number, and saves anyway', async () => {
    // Families share one phone, deliberately (SU-08): a warning, never a refusal.
    const store = new FakeStore();
    store.othersOnThatMobile = 2;

    const result = await editMember({ memberId: 'mem_1', values: values({ mobile: '+919000000001' }) }, deps(store));

    expect(result.sharesMobileWith).toBe(2);
    expect(store.saved).toHaveLength(1);
  });

  it('does not count a shared number when the number did not change', async () => {
    const store = new FakeStore();
    store.othersOnThatMobile = 2;

    const result = await editMember({ memberId: 'mem_1', values: values({ fullName: 'सुरेश कुमार' }) }, deps(store));

    expect(result.sharesMobileWith).toBe(0);
  });

  it('lets reception correct a member, and refuses a trainer', async () => {
    const store = new FakeStore();
    await expect(editMember({ memberId: 'mem_1', values: values({ dob: istDate('1995-05-06') }) }, deps(store, reception))).resolves.toBeDefined();

    await expect(editMember({ memberId: 'mem_1', values: values({ dob: istDate('1995-05-07') }) }, deps(new FakeStore(), trainer))).rejects.toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }) as Error,
    );
  });

  it('refuses a member who is not in this gym', async () => {
    const store = new FakeStore();
    store.member = null;

    await expect(editMember({ memberId: 'mem_1', values: values() }, deps(store))).rejects.toThrow(DomainError);
  });

  it('refuses to edit a member whose data has been erased', async () => {
    // An erasure is final; typing a name back in would undo it (privacy plan §6).
    const store = new FakeStore();
    store.member = { ...onFile, deletedAt: new Date('2026-09-01T00:00:00Z') };

    await expect(editMember({ memberId: 'mem_1', values: values({ fullName: 'कोई और' }) }, deps(store))).rejects.toThrow(
      expect.objectContaining({ code: 'CONFLICT' }) as Error,
    );
  });

  it('saves the three details the desk had no way to correct (ADR-099)', async () => {
    // When they joined, what the desk wrote about them, and whether they agreed to be
    // messaged. All three were shown on the profile and were on no form, so a wrong one
    // stayed wrong.
    const store = new FakeStore();

    const result = await editMember(
      { memberId: 'mem_1', values: values({ joinedOn: istDate('2024-03-01'), notes: 'Knee injury — no heavy squats', whatsappOptIn: true }) },
      deps(store),
    );

    expect(result.changed).toEqual(expect.arrayContaining(['joinedOn', 'notes', 'whatsappOptIn']));
    expect(store.saved[0]?.values.joinedOn).toBe('2024-03-01');
    expect(store.saved[0]?.values.notes).toBe('Knee injury — no heavy squats');
    expect(store.saved[0]?.values.whatsappOptIn).toBe(true);
  });

  it('counts messaging being turned off as a change, because consent going is the point', async () => {
    const store = new FakeStore();
    store.member = { ...onFile, whatsappOptIn: true };

    const result = await editMember({ memberId: 'mem_1', values: values({ whatsappOptIn: false }) }, deps(store));

    expect(result.changed).toContain('whatsappOptIn');
    expect(store.saved[0]?.values.whatsappOptIn).toBe(false);
  });

  it('saves nothing when the new fields are left as they were', async () => {
    const store = new FakeStore();
    const result = await editMember({ memberId: 'mem_1', values: values() }, deps(store));

    expect(result.changed).toEqual([]);
    expect(store.saved).toEqual([]);
  });
});
