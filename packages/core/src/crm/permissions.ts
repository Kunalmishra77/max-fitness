import { DomainError } from '../errors';

/**
 * Who may do what in the CRM (crm-module-spec.md §3; security-plan.md §3.1).
 *
 * Checked on the server in every service call. The client uses the same function only
 * to hide buttons — hiding is courtesy, this is the rule.
 *
 * Two things beyond the role matter. Sensitive actions (settings, voiding a payment,
 * exporting a member) need a PIN entered in the last few minutes, so a phone left
 * unlocked on the desk cannot be used for them. And reception taking payments is a
 * setting the owner controls.
 */

export type CrmRole = 'OWNER' | 'RECEPTION' | 'TRAINER' | 'SUPER_ADMIN';

export const CRM_CAPABILITIES = [
  'home.view',
  'money.view',
  'member.view',
  'member.edit',
  'payment.record',
  'payment.discount',
  'payment.void',
  'member.markLeft',
  'member.reactivate',
  'verification.approve',
  'attendance.manual',
  'call.outcome',
  'settings.manage',
  'member.export',
  'member.erase',
] as const;
export type CrmCapability = (typeof CRM_CAPABILITIES)[number];

export interface CrmActor {
  readonly staffUserId: string;
  readonly gymId: string;
  readonly role: CrmRole;
  /** When the last PIN re-entry stops counting, or `null` if there was none. */
  readonly elevatedUntil: Date | null;
  /** BR: the owner decides whether reception may take money (crm-module-spec §3). */
  readonly receptionMayTakePayments: boolean;
}

/** How long a PIN re-entry counts for (security-plan.md §3.1: 5 minutes). */
export const PIN_ELEVATION_MINUTES = 5;

const ROLES: Record<CrmCapability, readonly CrmRole[]> = {
  'home.view': ['OWNER', 'RECEPTION', 'TRAINER', 'SUPER_ADMIN'],
  'money.view': ['OWNER', 'SUPER_ADMIN'],
  'member.view': ['OWNER', 'RECEPTION', 'TRAINER', 'SUPER_ADMIN'],
  'member.edit': ['OWNER', 'RECEPTION', 'SUPER_ADMIN'],
  'payment.record': ['OWNER', 'RECEPTION', 'SUPER_ADMIN'],
  'payment.discount': ['OWNER', 'RECEPTION', 'SUPER_ADMIN'],
  'payment.void': ['OWNER', 'SUPER_ADMIN'],
  'member.markLeft': ['OWNER', 'RECEPTION', 'SUPER_ADMIN'],
  'member.reactivate': ['OWNER', 'SUPER_ADMIN'],
  'verification.approve': ['OWNER', 'RECEPTION', 'SUPER_ADMIN'],
  'attendance.manual': ['OWNER', 'RECEPTION', 'TRAINER', 'SUPER_ADMIN'],
  'call.outcome': ['OWNER', 'RECEPTION', 'SUPER_ADMIN'],
  'settings.manage': ['OWNER', 'SUPER_ADMIN'],
  'member.export': ['OWNER', 'SUPER_ADMIN'],
  'member.erase': ['OWNER', 'SUPER_ADMIN'],
};

/** Actions that need a PIN entered in the last few minutes, whatever the role. */
const NEEDS_ELEVATION: ReadonlySet<CrmCapability> = new Set(['payment.void', 'settings.manage', 'member.export', 'member.erase']);

/** Reception may take money only while the gym's setting allows it. */
const RECEPTION_PAYMENT_CAPABILITIES: ReadonlySet<CrmCapability> = new Set(['payment.record', 'payment.discount']);

/** `now` is always passed in: core never reads the wall clock (CLAUDE.md §2.2). */
export function can(actor: CrmActor, capability: CrmCapability, now: Date): boolean {
  if (!ROLES[capability].includes(actor.role)) return false;
  if (actor.role === 'RECEPTION' && RECEPTION_PAYMENT_CAPABILITIES.has(capability) && !actor.receptionMayTakePayments) return false;
  if (NEEDS_ELEVATION.has(capability) && (actor.elevatedUntil === null || actor.elevatedUntil.getTime() <= now.getTime())) return false;
  return true;
}

/**
 * Would entering the PIN right now be enough for this?
 *
 * Screens need this to decide whether to offer the PIN at all: a receptionist should
 * never be asked for a PIN to void a payment, because no PIN would help. It answers a
 * question about the role, and grants nothing — the action itself still goes through
 * `can`, which refuses until the PIN has actually been entered.
 */
export function mayAfterPinEntry(actor: CrmActor, capability: CrmCapability, now: Date): boolean {
  return can({ ...actor, elevatedUntil: new Date(now.getTime() + PIN_ELEVATION_MINUTES * 60_000) }, capability, now);
}

export function assertCan(actor: CrmActor, capability: CrmCapability, now: Date): void {
  if (!can(actor, capability, now)) {
    throw new DomainError('FORBIDDEN', 'Not allowed', { capability, role: actor.role });
  }
}
