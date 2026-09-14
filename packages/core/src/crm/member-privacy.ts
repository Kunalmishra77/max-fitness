import type { Clock } from '@mfp/shared';
import { DomainError } from '../errors';
import type { StorageDriver } from '../ports/storage';
import { assertCan, type CrmActor } from './permissions';

/**
 * A member's rights over their data (privacy-and-dpdp-compliance §6; crm-module-spec §3).
 *
 * **Access** — `exportMemberData` hands over everything held about a member as one JSON
 * document: profile, memberships, payments, attendance, consents, messages and call
 * notes. Face templates are counted, never exported: a template is a biometric vector,
 * not something a member can read, and copying it into a file would only spread it.
 *
 * **Erasure** — `eraseMember` removes the person and keeps the accounts. The member is
 * anonymised; photos, receipt PDFs (they carry the name) and face data are deleted;
 * message text, alert details, call notes and linked enquiries are scrubbed. Consents
 * stay as minimal proof of what was agreed, and payments stay under the pseudonymous
 * member code, because the accounts must still add up (privacy plan §6; database design §7).
 *
 * Both need the owner with a PIN entered a moment ago, and both are audited without
 * copying any personal data into the audit log. The erasure's audit row is written in the
 * same transaction as the erasure, so one can never happen without the other; stored
 * files are deleted after that commits, and any that will not go are reported back.
 */

export interface MemberExport {
  readonly member: {
    readonly id: string;
    readonly memberCode: string | null;
    readonly fullName: string;
    readonly mobile: string;
    readonly email: string | null;
    readonly dob: string | null;
    readonly gender: string;
    readonly language: string;
    readonly status: string;
    readonly source: string;
    readonly createdAt: string;
    readonly whatsappOptIn: boolean;
    readonly faceConsent: boolean;
    readonly hasPhoto: boolean;
  };
  readonly memberships: ReadonlyArray<{
    readonly startDate: string | null;
    readonly endDate: string;
    readonly durationMonths: number | null;
    readonly pricePaise: number;
    readonly status: string;
  }>;
  readonly payments: ReadonlyArray<{
    readonly amountPaise: number;
    readonly method: string;
    readonly status: string;
    readonly receiptNo: string | null;
    readonly paidAt: string | null;
  }>;
  readonly attendance: ReadonlyArray<{ readonly date: string; readonly method: string }>;
  readonly consents: ReadonlyArray<{
    readonly type: string;
    readonly granted: boolean;
    readonly noticeVersion: string;
    readonly channel: string;
    readonly createdAt: string;
    readonly withdrawnAt: string | null;
  }>;
  readonly messages: ReadonlyArray<{ readonly purpose: string; readonly status: string; readonly sentAt: string | null; readonly text: string | null }>;
  readonly callTasks: ReadonlyArray<{
    readonly reason: string;
    readonly status: string;
    readonly outcome: string | null;
    readonly note: string | null;
    readonly createdAt: string;
  }>;
  readonly faceTemplates: { readonly count: number };
}

export interface MemberForErasure {
  readonly id: string;
  readonly memberCode: string | null;
  readonly deletedAt: Date | null;
}

export interface PrivacyAuditEntry {
  readonly gymId: string;
  readonly actorType: 'staff';
  readonly actorId: string;
  readonly action: 'member.export' | 'member.erase';
  readonly entityType: 'Member';
  readonly entityId: string;
  readonly before: Readonly<Record<string, unknown>>;
  readonly after: Readonly<Record<string, unknown>>;
}

export interface MemberPrivacyStore {
  /** Everything held about a member who has not been erased, or `null`. */
  loadMemberExport(gymId: string, memberId: string): Promise<MemberExport | null>;
  findMemberForErasure(gymId: string, memberId: string): Promise<MemberForErasure | null>;
  anonymiseMember(memberId: string, at: Date): Promise<void>;
  /** Marks the member's photos and receipt PDFs deleted; returns their storage keys. */
  markMemberMediaDeleted(memberId: string, at: Date): Promise<readonly string[]>;
  /** Deletes face templates and enrolment jobs; returns how many templates went. */
  deleteFaceData(memberId: string): Promise<number>;
  scrubMessages(memberId: string): Promise<void>;
  scrubAlerts(memberId: string): Promise<void>;
  closeCallTasks(memberId: string, at: Date): Promise<void>;
  anonymiseConvertedLeads(memberId: string): Promise<void>;
  writeAudit(entry: PrivacyAuditEntry): Promise<void>;
}

export interface MemberErasureUnitOfWork {
  transaction<T>(work: (store: MemberPrivacyStore) => Promise<T>): Promise<T>;
}

export const MEMBER_EXPORT_FORMAT = 'max-fitness-member-export/1';

const audit = (actor: CrmActor, action: PrivacyAuditEntry['action'], memberId: string, before: Record<string, unknown>, after: Record<string, unknown>): PrivacyAuditEntry => ({
  gymId: actor.gymId,
  actorType: 'staff',
  actorId: actor.staffUserId,
  action,
  entityType: 'Member',
  entityId: memberId,
  before,
  after,
});

// ── Access ──────────────────────────────────────────────────────────────────

export async function exportMemberData(
  input: { readonly memberId: string },
  deps: { readonly actor: CrmActor; readonly clock: Clock; readonly store: Pick<MemberPrivacyStore, 'loadMemberExport' | 'writeAudit'> },
): Promise<{ readonly format: typeof MEMBER_EXPORT_FORMAT; readonly exportedAt: string; readonly data: MemberExport }> {
  const now = deps.clock.now();
  assertCan(deps.actor, 'member.export', now);

  const data = await deps.store.loadMemberExport(deps.actor.gymId, input.memberId);
  if (data === null) throw new DomainError('NOT_FOUND', 'No such member, or their data has been erased');

  await deps.store.writeAudit(audit(deps.actor, 'member.export', input.memberId, {}, {}));
  return { format: MEMBER_EXPORT_FORMAT, exportedAt: now.toISOString(), data };
}

// ── Erasure ─────────────────────────────────────────────────────────────────

export async function eraseMember(
  input: { readonly memberId: string; readonly reason: string },
  deps: { readonly actor: CrmActor; readonly clock: Clock; readonly uow: MemberErasureUnitOfWork; readonly storage: StorageDriver },
): Promise<{ readonly memberId: string; readonly filesDeleted: number; readonly filesNotDeleted: readonly string[]; readonly faceTemplatesDeleted: number }> {
  const now = deps.clock.now();
  assertCan(deps.actor, 'member.erase', now);

  const reason = input.reason.trim();
  if (reason === '') throw new DomainError('VALIDATION_FAILED', 'An erasure needs a reason', { field: 'reason' });

  const { keys, faceTemplatesDeleted } = await deps.uow.transaction(async (store) => {
    const member = await store.findMemberForErasure(deps.actor.gymId, input.memberId);
    if (member === null) throw new DomainError('NOT_FOUND', 'No such member');
    if (member.deletedAt !== null) throw new DomainError('CONFLICT', "This member's data has already been erased");

    await store.anonymiseMember(member.id, now);
    const mediaKeys = await store.markMemberMediaDeleted(member.id, now);
    const templates = await store.deleteFaceData(member.id);
    await store.scrubMessages(member.id);
    await store.scrubAlerts(member.id);
    await store.closeCallTasks(member.id, now);
    await store.anonymiseConvertedLeads(member.id);

    await store.writeAudit(
      audit(deps.actor, 'member.erase', member.id, { memberCode: member.memberCode }, { erased: true, reason, files: mediaKeys.length, faceTemplatesDeleted: templates }),
    );
    return { keys: mediaKeys, faceTemplatesDeleted: templates };
  });

  // Object storage cannot join the transaction. The rows already say "deleted"; a file
  // that will not go now is reported so it can be removed again, and never undoes the erasure.
  const filesNotDeleted: string[] = [];
  for (const key of keys) {
    try {
      await deps.storage.delete(key);
    } catch {
      filesNotDeleted.push(key);
    }
  }

  return { memberId: input.memberId, filesDeleted: keys.length - filesNotDeleted.length, filesNotDeleted, faceTemplatesDeleted };
}
