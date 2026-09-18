import { todayIST, type Clock, type ISTDate, type PlanDurationMonths } from '@mfp/shared';
import { DomainError } from '../errors';
import { declaredMembershipPeriod } from '../membership/dates';
import { formatMemberCode, MEMBER_CODE_COUNTER_KEY } from '../payments/receipt-number';
import { assertDeclaredEndDate } from '../qr/existing-member';
import { assertCan, type CrmActor } from './permissions';

/**
 * The verify queue, "जाँचें" (crm-ux-blueprint §9; qr-onboarding-flow §4; BR-13; ADR-058).
 *
 * **Approve** makes the member ACTIVE with a declared membership (BR-3.6) ending on the
 * chosen date: for a member found in the paper register, that register membership is
 * moved to the chosen date; otherwise a new declared membership is made. The date the
 * member gave stays on the request and in the audit (BR-13.2). A member code is given
 * if the member has none, the open `VERIFICATION_PENDING` call is closed, and the
 * approval message is queued for the WhatsApp engine.
 *
 * **Reject** needs a reason and leaves the member unverified (BR-13.3); removing the
 * member after seven days is the nightly job's work.
 *
 * Either way the request row is locked and decided once.
 */

export interface LockedVerification {
  readonly id: string;
  readonly memberId: string;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED';
  readonly declaredPlanMonths: PlanDurationMonths | null;
  readonly declaredEndDate: ISTDate;
  readonly declaredAmountPaise: number | null;
  readonly matchedImportMemberId: string | null;
}

export interface DeclaredMembershipRecord {
  readonly gymId: string;
  readonly memberId: string;
  readonly durationMonths: PlanDurationMonths | null;
  readonly startDate: ISTDate | null;
  readonly endDate: ISTDate;
  readonly declaredEndDate: ISTDate;
  readonly pricePaise: number;
  readonly createdById: string;
}

export interface VerificationAuditEntry {
  readonly gymId: string;
  readonly actorType: 'staff';
  readonly actorId: string;
  readonly action: 'verification.approve' | 'verification.reject';
  readonly entityType: 'VerificationRequest';
  readonly entityId: string;
  readonly after: Readonly<Record<string, string | number | null>>;
}

export interface VerificationStore {
  /** The request, locked for this transaction; `null` if it is not this gym's. */
  lockRequest(gymId: string, verificationId: string): Promise<LockedVerification | null>;
  getMember(memberId: string): Promise<{ readonly id: string; readonly memberCode: string | null; readonly status: string }>;
  /** The confirmed, declared membership the register import made, if any. */
  findDeclaredImportMembership(memberId: string): Promise<{ readonly id: string; readonly endDate: ISTDate } | null>;
  updateDeclaredMembership(
    membershipId: string,
    values: { readonly startDate: ISTDate | null; readonly endDate: ISTDate; readonly durationMonths: PlanDurationMonths | null },
  ): Promise<void>;
  createDeclaredMembership(record: DeclaredMembershipRecord): Promise<string>;
  nextCounterValue(gymId: string, key: string): Promise<number>;
  activateMember(memberId: string, memberCode: string): Promise<void>;
  decide(
    verificationId: string,
    values:
      | { readonly status: 'APPROVED'; readonly decidedById: string; readonly decidedAt: Date; readonly approvedEndDate: ISTDate }
      | { readonly status: 'REJECTED'; readonly decidedById: string; readonly decidedAt: Date; readonly rejectReason: string },
  ): Promise<void>;
  closeVerificationCalls(memberId: string, at: Date): Promise<void>;
  enqueueOutbox(event: { readonly gymId: string; readonly type: string; readonly dedupeKey: string; readonly payload: Record<string, unknown> }): Promise<void>;
  writeAudit(entry: VerificationAuditEntry): Promise<void>;
}

export interface VerificationUnitOfWork {
  transaction<T>(work: (store: VerificationStore) => Promise<T>): Promise<T>;
}

interface Deps {
  readonly actor: CrmActor;
  readonly clock: Clock;
  readonly uow: VerificationUnitOfWork;
}

async function lockPending(store: VerificationStore, actor: CrmActor, verificationId: string): Promise<LockedVerification> {
  const request = await store.lockRequest(actor.gymId, verificationId);
  if (request === null) throw new DomainError('NOT_FOUND', 'No such verification request');
  if (request.status !== 'PENDING') throw new DomainError('CONFLICT', 'This request has already been decided', { status: request.status });
  return request;
}

export async function approveVerification(
  input: { readonly verificationId: string; readonly approvedEndDate?: ISTDate; readonly planMonths?: PlanDurationMonths },
  deps: Deps,
): Promise<{ readonly memberId: string; readonly memberCode: string; readonly startDate: ISTDate | null; readonly endDate: ISTDate }> {
  const { actor, clock } = deps;
  const now = clock.now();
  assertCan(actor, 'verification.approve', now);
  if (input.approvedEndDate !== undefined) assertDeclaredEndDate(input.approvedEndDate, todayIST(clock), 'approvedEndDate');

  return deps.uow.transaction(async (store) => {
    const request = await lockPending(store, actor, input.verificationId);
    const endDate = input.approvedEndDate ?? request.declaredEndDate;
    const months = input.planMonths ?? request.declaredPlanMonths;
    const { startDate } = declaredMembershipPeriod(endDate, months);

    const imported = request.matchedImportMemberId === null ? null : await store.findDeclaredImportMembership(request.memberId);
    if (imported === null) {
      await store.createDeclaredMembership({
        gymId: actor.gymId,
        memberId: request.memberId,
        durationMonths: months,
        startDate,
        endDate,
        declaredEndDate: request.declaredEndDate,
        pricePaise: request.declaredAmountPaise ?? 0,
        createdById: actor.staffUserId,
      });
    } else {
      await store.updateDeclaredMembership(imported.id, { startDate, endDate, durationMonths: months });
    }

    const member = await store.getMember(request.memberId);
    const memberCode = member.memberCode ?? formatMemberCode(await store.nextCounterValue(actor.gymId, MEMBER_CODE_COUNTER_KEY));
    await store.activateMember(member.id, memberCode);

    await store.decide(request.id, { status: 'APPROVED', decidedById: actor.staffUserId, decidedAt: now, approvedEndDate: endDate });
    await store.closeVerificationCalls(member.id, now);
    await store.enqueueOutbox({
      gymId: actor.gymId,
      type: 'whatsapp.verification_approved',
      dedupeKey: `verification-approved:${request.id}`,
      payload: { memberId: member.id },
    });
    await store.writeAudit({
      gymId: actor.gymId,
      actorType: 'staff',
      actorId: actor.staffUserId,
      action: 'verification.approve',
      entityType: 'VerificationRequest',
      entityId: request.id,
      after: {
        declaredEndDate: request.declaredEndDate,
        approvedEndDate: endDate,
        planMonths: months,
        registerMatch: imported === null ? 'no' : 'yes',
      },
    });

    return { memberId: member.id, memberCode, startDate, endDate };
  });
}

export async function rejectVerification(input: { readonly verificationId: string; readonly reason: string }, deps: Deps): Promise<void> {
  const { actor, clock } = deps;
  const now = clock.now();
  assertCan(actor, 'verification.approve', now);
  const reason = input.reason.trim();
  if (reason === '') throw new DomainError('VALIDATION_FAILED', 'A rejection needs a reason', { field: 'reason' });

  await deps.uow.transaction(async (store) => {
    const request = await lockPending(store, actor, input.verificationId);
    await store.decide(request.id, { status: 'REJECTED', decidedById: actor.staffUserId, decidedAt: now, rejectReason: reason });
    await store.closeVerificationCalls(request.memberId, now);
    await store.writeAudit({
      gymId: actor.gymId,
      actorType: 'staff',
      actorId: actor.staffUserId,
      action: 'verification.reject',
      entityType: 'VerificationRequest',
      entityId: request.id,
      after: { reason, declaredEndDate: request.declaredEndDate },
    });
  });
}
