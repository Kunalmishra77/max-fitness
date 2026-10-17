import { maskEmail, maskMobile, maskName, maskStorageKey, maskToken } from '@mfp/shared';

/**
 * Turning an audit row's `before`/`after` into something safe to show (CRM-AUDIT).
 *
 * `AuditLog` has been written to since the first migration — every voided payment, erased
 * member, PIN reset and settings change — and nothing in the CRM ever displayed it. So the
 * gym's whole accountability trail existed and was invisible, which is the worst of both:
 * the cost of recording it without the benefit.
 *
 * **The blobs cannot simply be printed.** They are whole row snapshots, so they carry
 * mobile numbers, email addresses, PIN hashes, storage keys and whatever a future column
 * adds. An audit screen that leaks the data it is auditing is worse than no audit screen,
 * and "we will remember to redact the next field someone adds" is not a control.
 *
 * So this is a **denylist by key name, applied before any value is read**, and it works on
 * the key rather than the value — a mobile number is sensitive because of what the field
 * *is*, not because of what it looks like. Anything unrecognised is shown, which is the
 * right default for an audit trail (the point is to see what changed), but every known
 * sensitive shape is masked with the same helpers the logger uses, and anything that merely
 * *smells* like a secret is masked on the strength of its name alone.
 *
 * What the owner gets is which fields changed and what they changed to — "fees paid till:
 * 30 Sep → 31 Oct" — which is the question an audit trail is opened to answer.
 */

/** Masked with the shared helpers: the shape is known, so the masking can be specific. */
const MASKERS: Record<string, (value: string) => string> = {
  mobile: maskMobile,
  phone: maskMobile,
  email: maskEmail,
  fullname: maskName,
  name: maskName,
  storagekey: maskStorageKey,
  photokey: maskStorageKey,
};

/**
 * Key fragments that mean "never show this".
 *
 * Matched as substrings of the lower-cased key, so `pinHash`, `newPinHash` and
 * `staffPinHash` are all caught by `pin` without needing to be listed. Erring towards
 * masking: a field wrongly masked costs the owner one question, and a field wrongly shown
 * costs a member their privacy.
 */
const NEVER_SHOW = ['pin', 'hash', 'token', 'secret', 'password', 'vector', 'embedding', 'template', 'signature', 'otp', 'apikey', 'key'];

/** Long enough to be useful, short enough not to turn a row into a wall. */
const MAX_VALUE_LENGTH = 60;

export interface AuditChange {
  readonly field: string;
  readonly before: string | null;
  readonly after: string | null;
}

/** One value, rendered for display and masked if its key says it must be. */
export function auditValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;

  const lower = key.toLowerCase();
  if (NEVER_SHOW.some((fragment) => lower.includes(fragment))) return maskToken(null);

  /**
   * Shape before name. This check used to come *after* the maskers, so a key called
   * `mobile` holding an object rendered as the literal `[object Object]` — harmless to
   * read and exactly the sort of thing that becomes a leak when a column changes type.
   * A nested value is summarised rather than printed: recursing would mean a denylist
   * that has to hold at every depth, and nobody reads a blob.
   */
  if (typeof value === 'object') {
    return Array.isArray(value) ? `[${value.length}]` : '{…}';
  }

  const rendered = typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' ? String(value) : '{…}';

  const masker = MASKERS[lower];
  if (masker !== undefined) return masker(rendered);

  return rendered.length > MAX_VALUE_LENGTH ? `${rendered.slice(0, MAX_VALUE_LENGTH)}…` : rendered;
}

/**
 * Which fields differ between two snapshots.
 *
 * Both sides are considered, so a field only present in `before` reads as a removal and one
 * only in `after` as an addition — a column dropped from a row is a change worth seeing.
 * Fields that did not change are left out: an audit row listing forty identical values
 * hides the one that moved.
 *
 * Compared **before masking**, so two different mobile numbers are not both `98xxxxxx21`
 * and therefore equal. Masking is for display only and must never decide what changed.
 */
export function auditChanges(before: unknown, after: unknown): AuditChange[] {
  const a = asRecord(before);
  const b = asRecord(after);
  if (a === null && b === null) return [];

  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort();

  const changes: AuditChange[] = [];
  for (const key of keys) {
    const rawBefore = a?.[key];
    const rawAfter = b?.[key];
    if (sameValue(rawBefore, rawAfter)) continue;
    changes.push({ field: key, before: auditValue(key, rawBefore), after: auditValue(key, rawAfter) });
  }
  return changes;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Equality for two snapshot values.
 *
 * `JSON.stringify` for objects, which is enough here because both sides come from the same
 * serialiser and so have the same key order. `null` and `undefined` are treated as the same
 * thing: a field absent from a snapshot and a field explicitly null are not a change
 * anybody needs to see.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return a === b;
}
