import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { DomainErrorCode } from '@mfp/core';

/**
 * API response envelope (api-specification.md §1).
 *
 * Success: `{ data, meta: { requestId } }` · Error: `{ error: { code, message, details? }, meta }`.
 * Messages here are generic and English on purpose: clients render their own
 * translated text from `code` and `details`, and nothing internal (a stack, a driver
 * message, a connection string) ever reaches a response.
 */

export type ApiErrorCode =
  | DomainErrorCode
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNAUTHENTICATED'
  | 'SELFIE_REJECTED'
  | 'PAYMENT_PROVIDER_UNAVAILABLE'
  | 'INTERNAL';

export function newRequestId(): string {
  return `req_${randomBytes(8).toString('hex')}`;
}

export function apiData<T>(data: T, requestId: string, status = 200): NextResponse {
  return NextResponse.json({ data, meta: { requestId } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  requestId: string,
  options: { details?: Record<string, unknown>; headers?: Record<string, string> } = {},
): NextResponse {
  return NextResponse.json(
    {
      error: { code, message, ...(options.details === undefined ? {} : { details: options.details }) },
      meta: { requestId },
    },
    { status, headers: { 'Cache-Control': 'no-store', ...options.headers } },
  );
}
