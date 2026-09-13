import { createHmac } from 'node:crypto';
import { DomainError, issueToken, verifyTokenOrThrow } from '@mfp/core';
import type { Clock } from '@mfp/shared';

/**
 * Who may act on a sign-up or renewal without an account (api-specification.md §2).
 *
 * The registration token comes back from `POST /registrations` and lives in the
 * browser's sessionStorage for the rest of the flow; a renew token arrives in a
 * WhatsApp link. Both are purpose-bound signed tokens naming a member, sent as
 * headers so they never land in a URL, a referrer or an access log.
 */

export const REGISTRATION_TOKEN_HEADER = 'x-registration-token';
export const RENEW_TOKEN_HEADER = 'x-renew-token';

/** Receipt links go out on WhatsApp and are opened again weeks later (decision-log). */
export const RECEIPT_LINK_TTL_SECONDS = 90 * 86_400;

export interface TokenDeps {
  readonly secret: string;
  readonly clock: Clock;
}

export interface CheckoutAccess {
  readonly memberId: string;
  readonly mode: 'signup' | 'renewal';
}

export function checkoutAccess(headers: Headers, deps: TokenDeps): CheckoutAccess {
  const registration = headers.get(REGISTRATION_TOKEN_HEADER);
  if (registration !== null && registration !== '') {
    return { memberId: verifyTokenOrThrow({ token: registration, purpose: 'registration', ...deps }), mode: 'signup' };
  }
  const renew = headers.get(RENEW_TOKEN_HEADER);
  if (renew !== null && renew !== '') {
    return { memberId: verifyTokenOrThrow({ token: renew, purpose: 'renew', ...deps }), mode: 'renewal' };
  }
  throw new DomainError('TOKEN_INVALID', 'A sign-up or renew token is required');
}

/**
 * The client IP for a consent record, as a keyed hash (privacy plan §4).
 *
 * Keyed rather than a plain SHA-256: there are only four billion IPv4 addresses, so
 * an unkeyed hash is reversible by anyone who can read the table.
 */
export function hashIp(ip: string, secret: string): string | null {
  if (ip === 'unknown') return null;
  return createHmac('sha256', secret).update(`ip:${ip}`).digest('base64url').slice(0, 32);
}

export function receiptUrl(paymentId: string, deps: TokenDeps & { readonly appUrl: string }): string {
  const token = issueToken({ purpose: 'receipt', subject: paymentId, ttlSeconds: RECEIPT_LINK_TTL_SECONDS, ...deps });
  return new URL(`/r/${token}`, deps.appUrl).toString();
}
