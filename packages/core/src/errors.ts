/**
 * Domain errors.
 *
 * coding-standards.md §2: never throw a string. Every failure a business rule can
 * produce carries a stable `code` that the API layer maps to an HTTP status and that
 * the UI maps to a translated message (TRD §5) — so error text can change without
 * breaking a client, and a log can be searched by code.
 */

export const DOMAIN_ERROR_CODES = [
  // Pricing and plans
  'PLAN_NOT_FOUND',
  'PLAN_INACTIVE',
  'INVALID_PLAN_DURATION',
  'PRICE_MISMATCH',
  'PLAN_GENDER_MISMATCH',

  // Membership dates
  'INVALID_START_DATE',
  'START_DATE_TOO_FAR_AHEAD',
  'MEMBERSHIP_OVERLAP',
  'MEMBERSHIP_NOT_FOUND',
  'UNKNOWN_PLAN_DURATION',

  // Members
  'MEMBER_NOT_FOUND',
  'MEMBER_NOT_ACTIVE',
  'MEMBER_BLOCKED',
  'UNDER_MINIMUM_AGE',
  'MISSING_PARENTAL_CONSENT',

  // Payments
  'PAYMENT_NOT_FOUND',
  'PAYMENT_ALREADY_SETTLED',
  'PAYMENT_AMOUNT_MISMATCH',
  'PARTIAL_PAYMENT_DISABLED',
  'INVALID_PAYMENT_SIGNATURE',
  'RECEIPT_COUNTER_UNAVAILABLE',

  // Reminders and consent
  'REMINDER_NOT_ELIGIBLE',
  'QUIET_HOURS_VIOLATION',
  'ALREADY_UNSUBSCRIBED',
  'RESTART_WINDOW_EXPIRED',

  // Attendance
  'ATTENDANCE_WITHIN_COOLDOWN',
  'ATTENDANCE_DUPLICATE',
  'MEMBER_NOT_IN_GALLERY',

  // Tokens
  'TOKEN_INVALID',
  'TOKEN_EXPIRED',
  'TOKEN_WRONG_PURPOSE',

  // CRM sign-in
  'INVALID_PIN',
  'ACCOUNT_LOCKED',
  'SESSION_EXPIRED',

  // One-time codes
  'OTP_INVALID',
  'OTP_EXPIRED',
  'OTP_LOCKED',
  'OTP_RATE_LIMITED',
  'OTP_REQUIRED',

  // Generic
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'FORBIDDEN',
  'CONFLICT',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

/** Extra context for logs and for building a translated message. Never put PII here. */
export type DomainErrorMeta = Readonly<Record<string, string | number | boolean | null>>;

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly meta: DomainErrorMeta;

  constructor(code: DomainErrorCode, message?: string, meta: DomainErrorMeta = {}) {
    super(message ?? code);
    this.name = 'DomainError';
    this.code = code;
    this.meta = meta;
  }

  /** Shape the API layer serialises (TRD §5). */
  toJSON(): { code: DomainErrorCode; message: string; meta: DomainErrorMeta } {
    return { code: this.code, message: this.message, meta: this.meta };
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export function domainError(
  code: DomainErrorCode,
  message?: string,
  meta?: DomainErrorMeta,
): DomainError {
  return new DomainError(code, message, meta);
}
