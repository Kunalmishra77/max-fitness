import type { NextResponse } from 'next/server';
import { isDomainError, type DomainErrorCode } from '@mfp/core';
import { PaymentProviderError } from '@mfp/integrations/payments';
import { apiError } from './api';
import { SelfieRejectedError } from './selfie-image';

/**
 * One place that turns a thrown error into an API response (api-specification.md §1).
 *
 * Domain errors carry a stable code the client translates; their `meta` is safe by
 * contract (errors.ts: never PII). Everything else — a gateway failure, a driver
 * error — is logged by class and request id only, because its message can contain a
 * connection string or a provider's wording, and answered generically.
 */

const STATUS: Partial<Record<DomainErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  TOKEN_INVALID: 401,
  TOKEN_EXPIRED: 401,
  TOKEN_WRONG_PURPOSE: 401,
  OTP_REQUIRED: 401,
  OTP_RATE_LIMITED: 429,
  FORBIDDEN: 403,
  MEMBER_BLOCKED: 403,
  NOT_FOUND: 404,
  MEMBER_NOT_FOUND: 404,
  PLAN_NOT_FOUND: 404,
  PAYMENT_NOT_FOUND: 404,
  MEMBERSHIP_NOT_FOUND: 404,
  CONFLICT: 409,
  PAYMENT_ALREADY_SETTLED: 409,
  // The gateway created an order for a different amount than we asked: its fault, not the client's.
  PRICE_MISMATCH: 502,
};

/** Every other domain code is a business rule refusing a well-formed request. */
export function statusForDomainError(code: DomainErrorCode): number {
  return STATUS[code] ?? 422;
}

const MESSAGES: Partial<Record<DomainErrorCode, string>> = {
  VALIDATION_FAILED: 'Some fields need attention',
  TOKEN_EXPIRED: 'This link has expired',
  TOKEN_INVALID: 'This link is not valid',
  TOKEN_WRONG_PURPOSE: 'This link is not valid',
  UNDER_MINIMUM_AGE: 'Below the minimum age to join',
  INVALID_PAYMENT_SIGNATURE: 'The payment could not be verified',
  CONFLICT: 'This has already been completed',
  OTP_INVALID: 'That code is not right',
  OTP_EXPIRED: 'That code has expired',
  OTP_LOCKED: 'Too many wrong codes',
  OTP_RATE_LIMITED: 'Too many codes for this number',
  OTP_REQUIRED: 'Confirm the mobile number first',
};

export function errorResponse(error: unknown, requestId: string, scope: string): NextResponse {
  if (isDomainError(error)) {
    const details = Object.keys(error.meta).length > 0 ? { details: { ...error.meta } } : {};
    return apiError(statusForDomainError(error.code), error.code, MESSAGES[error.code] ?? 'The request could not be completed', requestId, details);
  }

  if (error instanceof SelfieRejectedError) {
    return apiError(422, 'SELFIE_REJECTED', 'The photo could not be used', requestId, { details: { reason: error.reason } });
  }

  if (error instanceof PaymentProviderError) {
    // Operation and status are enough to diagnose; the provider's description stays out of logs too.
    console.error(`[${scope}] payment provider ${error.operation} failed (${error.status ?? 'network'}) ${requestId}`);
    return apiError(502, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Payments are unavailable right now', requestId);
  }

  console.error(`[${scope}] failed ${requestId}: ${error instanceof Error ? error.name : 'Error'}`);
  return apiError(500, 'INTERNAL', 'Something went wrong', requestId);
}
