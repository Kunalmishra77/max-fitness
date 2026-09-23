import type { NextRequest } from 'next/server';
import { PrismaKioskDevices } from '@mfp/db';
import { getContainer } from '@/lib/container';

/**
 * Who is holding the phone (api-specification.md §7; security-plan §3.4).
 *
 * Every kiosk endpoint but pairing carries `Authorization: Bearer <device token>`.
 * The token is never stored, so this is a lookup by peppered hash — which also means a
 * revoked device stops working the instant the owner taps Revoke, without waiting for
 * the phone to hear about it on its next beat.
 */

export interface KioskCaller {
  readonly deviceId: string;
  readonly gymId: string;
  readonly shadowMode: boolean;
}

export async function kioskCaller(request: NextRequest): Promise<KioskCaller | null> {
  const header = request.headers.get('authorization') ?? '';
  const [scheme, token] = header.split(' ', 2);
  if (scheme?.toLowerCase() !== 'bearer' || token === undefined || token.length === 0) return null;

  const container = getContainer();
  const device = await new PrismaKioskDevices(container.prisma).byToken(token, container.env.KIOSK_TOKEN_PEPPER);
  // A revoked device keeps no token, so this is belt and braces — and it stays correct
  // if a future change ever leaves the hash in place.
  if (device === null || device.status !== 'ACTIVE') return null;

  return { deviceId: device.id, gymId: device.gymId, shadowMode: device.shadowMode };
}
