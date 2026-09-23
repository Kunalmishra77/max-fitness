import { kioskIsOffline } from '@mfp/core';
import type { Clock } from '@mfp/shared';


/**
 * Noticing that the reception phone has gone quiet (BR-12; crm-module-spec §4).
 *
 * The job runs every ten minutes through gym hours, so spotting the silence is the
 * easy part. The hard part is telling the owner *once*: an alert every ten minutes
 * until somebody walks over and looks at the phone is how an owner learns to ignore
 * alerts. So a device is alerted again only after it has been heard from since the
 * last time it was reported.
 */

export interface OfflineCandidate {
  readonly id: string;
  readonly name: string;
  readonly lastSeenAt: Date | null;
  /** When the owner was last told this phone was quiet. */
  readonly alertedAt: Date | null;
}

export interface KioskOfflineDeps {
  readonly clock: Clock;
  readonly gymId: () => Promise<string>;
  readonly windowMinutes: () => Promise<number>;
  /** Paired, active devices only; an unpaired phone belongs to the pairing screen. */
  readonly pairedDevices: (gymId: string) => Promise<readonly OfflineCandidate[]>;
  readonly alertOffline: (deviceId: string, deviceName: string, minutesOffline: number) => Promise<void>;
  /** Only `warn` is used; a test does not need a whole logger to exercise the job. */
  readonly log: { warn: (fields: Record<string, unknown>, message: string) => void };
}

export async function runKioskOfflineCheck(deps: KioskOfflineDeps): Promise<{ checked: number; alerted: number }> {
  const gymId = await deps.gymId();
  const [windowMinutes, devices] = await Promise.all([deps.windowMinutes(), deps.pairedDevices(gymId)]);
  const now = deps.clock.now();

  let alerted = 0;
  for (const device of devices) {
    // A phone that has never beaten is not late; it is waiting to be paired, and the
    // pairing screen already says so.
    if (device.lastSeenAt === null) continue;
    if (!kioskIsOffline({ lastSeenAt: device.lastSeenAt }, now, windowMinutes)) continue;

    // Already reported, and nothing has happened since: not news.
    if (device.alertedAt !== null && device.alertedAt.getTime() >= device.lastSeenAt.getTime()) continue;

    const minutesOffline = Math.round((now.getTime() - device.lastSeenAt.getTime()) / 60_000);
    await deps.alertOffline(device.id, device.name, minutesOffline);
    deps.log.warn({ deviceId: device.id, minutesOffline }, 'attendance phone has gone quiet');
    alerted += 1;
  }

  return { checked: devices.length, alerted };
}
