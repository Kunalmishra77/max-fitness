/**
 * Sign-up progress between steps (signup-and-payment-flow.md §1).
 *
 * Kept in `sessionStorage` under `mfp_join`, so a refresh or a return from the payment
 * window keeps the member's place, and it ends with the tab. Never `localStorage`:
 * nothing about a sign-up should outlive the session on a shared phone. What is kept
 * is the minimum to continue — a token, a first name for the greeting, the choices
 * made — and every read is checked field by field, because storage is user-editable.
 *
 * Hand-written checks rather than Zod keep this out of the landing page's bundle (ADR-033).
 */

export const JOIN_STORAGE_KEY = 'mfp_join';

export interface JoinState {
  readonly registrationToken?: string;
  readonly firstName?: string;
  readonly gender?: 'MALE' | 'FEMALE' | 'OTHER';
  readonly isMinor?: boolean;
  readonly whatsappUpdates?: boolean;
  readonly planId?: string;
  readonly startDate?: string;
  /** Set once an online payment is confirmed; the done page reads its status again. */
  readonly paymentId?: string;
  /** Set when the member chose to pay at reception. */
  readonly reservedUntil?: string;
  readonly reservedAmountPaise?: number;
  /** Started from the reception QR: paying at the desk is offered as an equal choice. */
  readonly fromQr?: boolean;
}

type Patch = { [K in keyof JoinState]?: JoinState[K] | undefined };

const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1_000;
const CHECKS: { [K in keyof JoinState]-?: (value: unknown) => boolean } = {
  registrationToken: isString,
  firstName: (value) => isString(value) && value.length <= 60,
  gender: (value) => value === 'MALE' || value === 'FEMALE' || value === 'OTHER',
  isMinor: (value) => typeof value === 'boolean',
  whatsappUpdates: (value) => typeof value === 'boolean',
  planId: (value) => isString(value) && value.length <= 64,
  startDate: (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value),
  paymentId: (value) => isString(value) && value.length <= 64,
  reservedUntil: (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value)),
  reservedAmountPaise: (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
  fromQr: (value) => typeof value === 'boolean',
};

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readJoinState(): JoinState {
  let raw: string | null;
  try {
    raw = storage()?.getItem(JOIN_STORAGE_KEY) ?? null;
  } catch {
    return {};
  }
  if (raw === null) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};

  const state: Record<string, unknown> = {};
  for (const [key, check] of Object.entries(CHECKS)) {
    const value = (parsed as Record<string, unknown>)[key];
    if (check(value)) state[key] = value;
  }
  return state;
}

export function updateJoinState(patch: Patch): JoinState {
  const next: Record<string, unknown> = { ...readJoinState() };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  try {
    storage()?.setItem(JOIN_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or storage disabled: the flow still works within this page view.
  }
  return next;
}

export function clearJoinState(): void {
  try {
    storage()?.removeItem(JOIN_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
