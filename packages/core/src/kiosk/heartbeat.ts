import type { Clock } from '@mfp/shared';

/**
 * The kiosk's health beat (api-specification §7; attendance spec §11).
 *
 * The phone lives on a wall where nobody looks at it, so the only way anyone learns it
 * has stopped working is that it stops saying it is working. The beat carries what
 * actually goes wrong on a wall-mounted phone — heat, a dead camera, a full disk, a
 * queue that is not draining — and the reply is the server's one chance to tell a
 * device something, because the phone has no inbound port either.
 */

export interface KioskHealth {
  readonly battery: number;
  readonly charging: boolean;
  readonly temperatureC: number;
  readonly queueSize: number;
  readonly cameraOk: boolean;
  readonly freeStorageMb: number;
  readonly appVersion: string;
  readonly fps: number;
}

export type KioskCommand = 'SYNC_NOW' | 'RELOAD_SETTINGS' | 'WIPE_AND_UNPAIR';

export interface HeartbeatStore {
  device(deviceId: string): Promise<{ id: string; gymId: string; status: 'ACTIVE' | 'REVOKED'; shadowMode: boolean } | null>;
  save(deviceId: string, at: Date, health: Record<string, unknown>): Promise<void>;
}

export type HeartbeatResult =
  | { readonly ok: true; readonly serverTime: Date; readonly commands: readonly KioskCommand[]; readonly shadowMode: boolean }
  | { readonly ok: false };

export async function recordHeartbeat(
  input: { deviceId: string; health: KioskHealth },
  deps: { clock: Clock; store: HeartbeatStore },
): Promise<HeartbeatResult> {
  const device = await deps.store.device(input.deviceId);
  if (device === null) return { ok: false };

  const now = deps.clock.now();
  // Recorded even for a revoked device: the owner wants to see that the phone heard.
  await deps.store.save(device.id, now, { ...input.health });

  const commands: KioskCommand[] = device.status === 'REVOKED' ? ['WIPE_AND_UNPAIR'] : [];
  return { ok: true, serverTime: now, commands, shadowMode: device.shadowMode };
}

/**
 * Has the phone gone quiet? (BR-12; the `kiosk-offline-check` job.)
 *
 * The window itself still counts as fine — a beat that lands exactly on the boundary
 * is a beat — so only real silence raises the alert.
 */
export function kioskIsOffline(device: { lastSeenAt: Date | null }, now: Date, windowMinutes: number): boolean {
  if (device.lastSeenAt === null) return true;
  return now.getTime() - device.lastSeenAt.getTime() > windowMinutes * 60_000;
}
