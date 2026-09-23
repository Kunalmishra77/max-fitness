import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Clock } from '@mfp/shared';

/**
 * Pairing a reception phone to the gym (api-specification §7; security-plan §3.4).
 *
 * The code is six digits because someone has to read it off the CRM and type it on a
 * phone across the desk. Everything else is therefore tight: it lives ten minutes, it
 * is stored only as a peppered hash, and it is spent the moment it works — so a code
 * glimpsed over a shoulder is worth nothing a few minutes later, and a stolen
 * database row cannot be typed in anywhere.
 *
 * The token that replaces it is shown once, at pairing, and the server keeps only its
 * hash. A device that loses its token is paired again; there is nothing to recover.
 */

export const PAIRING_CODE_TTL_MINUTES = 10;
const DEVICE_TOKEN_BYTES = 32;

/** Peppered, so hashes lifted from one deployment are useless in another. */
function peppered(kind: string, value: string, pepper: string): string {
  return createHmac('sha256', pepper).update(`${kind}|${value}`).digest('hex');
}

export function hashPairingCode(code: string, pepper: string): string {
  return peppered('kiosk-pair', code, pepper);
}

export function hashDeviceToken(token: string, pepper: string): string {
  return peppered('kiosk-token', token, pepper);
}

export interface IssuedPairingCode {
  readonly code: string;
  readonly expiresAt: Date;
}

export function issuePairingCode(deps: { clock: Clock; random?: (bytes: number) => Buffer }): IssuedPairingCode {
  const random = deps.random ?? randomBytes;
  // Six digits from four random bytes, padded — 000123 is as good a code as 482913,
  // and dropping the leading zeros would quietly shrink the range.
  const code = String(random(4).readUInt32BE(0) % 1_000_000).padStart(6, '0');
  return { code, expiresAt: new Date(deps.clock.now().getTime() + PAIRING_CODE_TTL_MINUTES * 60_000) };
}

export interface PairingDeviceRow {
  readonly id: string;
  readonly gymId: string;
  readonly pairingCodeHash: string | null;
  readonly pairingExpires: Date | null;
  readonly status: 'ACTIVE' | 'REVOKED';
}

export interface PairingStore {
  findByPairingCodeHash(hash: string): Promise<PairingDeviceRow | null>;
  /** Stores the token hash and clears the code, so it cannot be used twice. */
  completePairing(deviceId: string, fields: { tokenHash: string; appVersion: string; modelVersion: string }): Promise<boolean>;
}

export type PairingResult =
  | { readonly outcome: 'PAIRED'; readonly deviceId: string; readonly gymId: string; readonly deviceToken: string }
  | { readonly outcome: 'INVALID_CODE' | 'CODE_EXPIRED' | 'REVOKED' };

export async function pairKioskDevice(
  input: { code: string; deviceName: string; appVersion: string; modelVersion: string },
  deps: { clock: Clock; pepper: string; random?: (bytes: number) => Buffer; store: PairingStore },
): Promise<PairingResult> {
  const device = await deps.store.findByPairingCodeHash(hashPairingCode(input.code, deps.pepper));
  if (device === null) return { outcome: 'INVALID_CODE' };
  if (device.status === 'REVOKED') return { outcome: 'REVOKED' };

  const now = deps.clock.now();
  // The last second counts: a code read out at 10:00 works until 10:10:00 exactly.
  if (device.pairingExpires === null || device.pairingExpires.getTime() < now.getTime()) return { outcome: 'CODE_EXPIRED' };

  const random = deps.random ?? randomBytes;
  const deviceToken = random(DEVICE_TOKEN_BYTES).toString('hex');
  const paired = await deps.store.completePairing(device.id, {
    tokenHash: hashDeviceToken(deviceToken, deps.pepper),
    appVersion: input.appVersion,
    modelVersion: input.modelVersion,
  });
  if (!paired) return { outcome: 'INVALID_CODE' };

  return { outcome: 'PAIRED', deviceId: device.id, gymId: device.gymId, deviceToken };
}

/**
 * Compare two hashes without leaking how far they matched.
 *
 * The lookup itself is by hash, so this is belt and braces for callers that compare a
 * stored hash directly.
 */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
