import type { Clock, Gender, ISTDate, Language, TrainingSlot } from '@mfp/shared';
import { DomainError } from '../errors';
import { assertCan, type CrmActor } from './permissions';

/**
 * Correcting a member's details (crm-ux-blueprint §5; PRD CRM-04).
 *
 * Details arrive from three doors — the desk, the website and a phone at the QR — so they
 * arrive wrong: a digit missed, a name spelt as it sounded, a date of birth skipped. This
 * is how the desk fixes that, and it is deliberately only the member's own details. Plan,
 * fees and status are changed by taking a payment or by the verification queue, which is
 * where the money and the dates are reasoned about.
 *
 * Three rules it enforces. An **erased** member cannot be edited: an erasure is final, and
 * typing a name back in would quietly undo it (privacy plan §6). A number that belongs to
 * another member is **reported, not refused** — families here share one phone (SU-08). And
 * the audit row names the fields that changed and never their values, because the audit log
 * is read by more people than the profile is (CLAUDE.md §2.8).
 */

export interface MemberEditValues {
  readonly fullName: string;
  readonly mobile: string;
  readonly email: string | null;
  readonly dob: ISTDate | null;
  readonly gender: Gender;
  readonly language: Language;
  readonly trainingSlot: TrainingSlot | null;
}

export interface MemberForEdit extends MemberEditValues {
  readonly id: string;
  readonly deletedAt: Date | null;
}

export type MemberEditField = keyof MemberEditValues;

export interface MemberEditAuditEntry {
  readonly gymId: string;
  readonly actorType: 'staff';
  readonly actorId: string;
  readonly action: 'member.edit';
  readonly entityType: 'Member';
  readonly entityId: string;
  readonly before: Readonly<Record<string, unknown>>;
  readonly after: Readonly<Record<string, unknown>>;
}

export interface MemberEditStore {
  findMemberForEdit(gymId: string, memberId: string): Promise<MemberForEdit | null>;
  /** How many *other* members of this gym are on that number (SU-08). */
  countOtherMembersWithMobile(gymId: string, mobile: string, exceptMemberId: string): Promise<number>;
  updateMember(memberId: string, values: MemberEditValues): Promise<void>;
  writeAudit(entry: MemberEditAuditEntry): Promise<void>;
}

export interface MemberEditUnitOfWork {
  transaction<T>(work: (store: MemberEditStore) => Promise<T>): Promise<T>;
}

export interface MemberEditResult {
  readonly memberId: string;
  /** The fields that actually moved; empty when the desk saved the form unchanged. */
  readonly changed: readonly MemberEditField[];
  /** Other members on the new number — a hint for staff, never a refusal. */
  readonly sharesMobileWith: number;
}

const FIELDS: readonly MemberEditField[] = ['fullName', 'mobile', 'email', 'dob', 'gender', 'language', 'trainingSlot'];

export async function editMember(
  input: { readonly memberId: string; readonly values: MemberEditValues },
  deps: { readonly actor: CrmActor; readonly clock: Clock; readonly uow: MemberEditUnitOfWork },
): Promise<MemberEditResult> {
  const now = deps.clock.now();
  assertCan(deps.actor, 'member.edit', now);

  return deps.uow.transaction(async (store) => {
    const member = await store.findMemberForEdit(deps.actor.gymId, input.memberId);
    if (member === null) throw new DomainError('NOT_FOUND', 'No such member');
    if (member.deletedAt !== null) throw new DomainError('CONFLICT', "This member's data has been erased and cannot be edited");

    const changed = FIELDS.filter((field) => member[field] !== input.values[field]);
    // Nothing to write, nothing to audit: opening the form and closing it is not an event.
    if (changed.length === 0) return { memberId: member.id, changed, sharesMobileWith: 0 };

    const sharesMobileWith = changed.includes('mobile')
      ? await store.countOtherMembersWithMobile(deps.actor.gymId, input.values.mobile, member.id)
      : 0;

    await store.updateMember(member.id, input.values);
    await store.writeAudit({
      gymId: deps.actor.gymId,
      actorType: 'staff',
      actorId: deps.actor.staffUserId,
      action: 'member.edit',
      entityType: 'Member',
      entityId: member.id,
      // Field names only. What changed is the auditable fact; the values are on the profile.
      before: {},
      after: { fields: changed, sharesMobileWith },
    });

    return { memberId: member.id, changed, sharesMobileWith };
  });
}
