import type { Clock } from '@mfp/shared';
import { DomainError } from '../errors';
import { assertCan, type CrmActor, type CrmRole } from './permissions';

/**
 * Managing the people who log in (crm-ux-blueprint §14; crm-module-spec §3; security-plan §3.1).
 *
 * The launch checklist says it plainly: owner and staff PINs are set by them, and the
 * demo users do not survive into production. So the owner adds reception and trainers
 * with PINs of their own, resets a forgotten PIN, and switches off someone who has left.
 *
 * Three rules carry the security weight:
 * - **a PIN never reaches the audit log**, neither the digits nor the hash;
 * - **a PIN reset or a switch-off signs that person out of every device at once** —
 *   a PIN that changed but a session that lives on would make the change decorative;
 * - **nobody becomes an owner, and no owner is locked out, from this screen.** An owner
 *   changes their own PIN with the current one, in a flow of its own.
 *
 * All of it needs `settings.manage`: the owner, with a PIN entered a moment ago.
 */

const PIN_PATTERN = /^\d{4,6}$/;
const ASSIGNABLE_ROLES: readonly CrmRole[] = ['RECEPTION', 'TRAINER'];
const OWNER_ROLES: readonly CrmRole[] = ['OWNER', 'SUPER_ADMIN'];

/** Hashing a new PIN. Kept apart from `PinHasher`, which only ever verifies. */
export interface PinSetter {
  hash(pin: string): Promise<string>;
}

export interface StaffForManagement {
  readonly id: string;
  readonly gymId: string;
  readonly role: CrmRole;
  readonly isActive: boolean;
}

export interface NewStaffRecord {
  readonly gymId: string;
  readonly name: string;
  readonly mobile: string;
  readonly role: 'RECEPTION' | 'TRAINER';
  readonly pinHash: string;
  readonly language: 'hi' | 'en';
}

export interface StaffAuditEntry {
  readonly gymId: string;
  readonly actorType: 'staff';
  readonly actorId: string;
  readonly action: 'staff.add' | 'staff.pin_reset' | 'staff.deactivate' | 'staff.activate';
  readonly entityType: 'StaffUser';
  readonly entityId: string;
  readonly before: Readonly<Record<string, unknown>>;
  readonly after: Readonly<Record<string, unknown>>;
}

export interface StaffStore {
  findStaff(gymId: string, staffUserId: string): Promise<StaffForManagement | null>;
  mobileTaken(gymId: string, mobile: string): Promise<boolean>;
  createStaff(record: NewStaffRecord): Promise<string>;
  /** Sets the PIN and clears any lockout from wrong guesses. */
  setPin(staffUserId: string, pinHash: string): Promise<void>;
  setActive(staffUserId: string, isActive: boolean): Promise<void>;
  /** Signs the person out of every device they are logged in on. */
  revokeSessions(staffUserId: string, at: Date): Promise<void>;
  writeAudit(entry: StaffAuditEntry): Promise<void>;
}

export interface StaffUnitOfWork {
  transaction<T>(work: (store: StaffStore) => Promise<T>): Promise<T>;
}

interface StaffDeps {
  readonly actor: CrmActor;
  readonly clock: Clock;
  readonly uow: StaffUnitOfWork;
}

function assertPin(pin: string): void {
  if (!PIN_PATTERN.test(pin)) throw new DomainError('VALIDATION_FAILED', 'A PIN is four to six digits', { field: 'pin' });
}

const audit = (actor: CrmActor, action: StaffAuditEntry['action'], entityId: string, before: Record<string, unknown>, after: Record<string, unknown>): StaffAuditEntry => ({
  gymId: actor.gymId,
  actorType: 'staff',
  actorId: actor.staffUserId,
  action,
  entityType: 'StaffUser',
  entityId,
  before,
  after,
});

// ── Add ─────────────────────────────────────────────────────────────────────

export async function addStaff(
  input: { readonly name: string; readonly mobile: string; readonly role: 'RECEPTION' | 'TRAINER'; readonly pin: string },
  deps: StaffDeps & { readonly hasher: PinSetter },
): Promise<{ readonly staffUserId: string }> {
  assertCan(deps.actor, 'settings.manage', deps.clock.now());
  if (!ASSIGNABLE_ROLES.includes(input.role)) {
    throw new DomainError('VALIDATION_FAILED', 'Only reception and trainers are added here', { field: 'role' });
  }
  assertPin(input.pin);

  // Argon2 takes tens of milliseconds by design; keep it out of the transaction.
  const pinHash = await deps.hasher.hash(input.pin);

  return deps.uow.transaction(async (store) => {
    if (await store.mobileTaken(deps.actor.gymId, input.mobile)) {
      throw new DomainError('CONFLICT', 'Someone at this gym already logs in with this number', { field: 'mobile' });
    }
    const staffUserId = await store.createStaff({
      gymId: deps.actor.gymId,
      name: input.name,
      mobile: input.mobile,
      role: input.role,
      pinHash,
      // The CRM is Hindi-first (CLAUDE.md §2.9); each person can switch later.
      language: 'hi',
    });
    await store.writeAudit(audit(deps.actor, 'staff.add', staffUserId, {}, { name: input.name, role: input.role }));
    return { staffUserId };
  });
}

// ── Reset a PIN ─────────────────────────────────────────────────────────────

export async function resetStaffPin(
  input: { readonly staffUserId: string; readonly pin: string },
  deps: StaffDeps & { readonly hasher: PinSetter },
): Promise<{ readonly staffUserId: string }> {
  assertCan(deps.actor, 'settings.manage', deps.clock.now());
  assertPin(input.pin);
  const now = deps.clock.now();

  return deps.uow.transaction(async (store) => {
    const target = await store.findStaff(deps.actor.gymId, input.staffUserId);
    if (target === null) throw new DomainError('NOT_FOUND', 'No such staff member');
    if (OWNER_ROLES.includes(target.role)) {
      throw new DomainError('FORBIDDEN', "An owner's PIN is changed by the owner, with the current PIN");
    }

    await store.setPin(target.id, await deps.hasher.hash(input.pin));
    await store.revokeSessions(target.id, now);
    await store.writeAudit(audit(deps.actor, 'staff.pin_reset', target.id, {}, {}));
    return { staffUserId: target.id };
  });
}

// ── Switch off / on ─────────────────────────────────────────────────────────

export async function setStaffActive(
  input: { readonly staffUserId: string; readonly active: boolean },
  deps: StaffDeps,
): Promise<{ readonly changed: boolean }> {
  assertCan(deps.actor, 'settings.manage', deps.clock.now());
  const now = deps.clock.now();

  return deps.uow.transaction(async (store) => {
    const target = await store.findStaff(deps.actor.gymId, input.staffUserId);
    if (target === null) throw new DomainError('NOT_FOUND', 'No such staff member');
    if (!input.active && (OWNER_ROLES.includes(target.role) || target.id === deps.actor.staffUserId)) {
      throw new DomainError('FORBIDDEN', 'An owner cannot be switched off from here');
    }
    if (target.isActive === input.active) return { changed: false };

    await store.setActive(target.id, input.active);
    if (!input.active) await store.revokeSessions(target.id, now);
    await store.writeAudit(
      audit(deps.actor, input.active ? 'staff.activate' : 'staff.deactivate', target.id, { isActive: target.isActive }, { isActive: input.active }),
    );
    return { changed: true };
  });
}
