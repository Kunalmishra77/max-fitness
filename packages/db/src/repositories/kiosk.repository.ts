import { hashDeviceToken, type HeartbeatStore, type PairingStore } from '@mfp/core';
import type { Prisma } from '../generated/prisma/client';
import type { PrismaClient } from '../client';

/**
 * The reception phone, as the database holds it (api-specification §7).
 *
 * A device is a row and a token hash, nothing more: the token itself is shown once at
 * pairing and never stored, so losing a phone costs the owner one tap to revoke and
 * one to pair its replacement.
 */

export interface KioskDeviceView {
  readonly id: string;
  readonly name: string;
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly paired: boolean;
  readonly shadowMode: boolean;
  readonly appVersion: string | null;
  readonly modelVersion: string | null;
  readonly lastSeenAt: Date | null;
  readonly lastHeartbeat: Record<string, unknown> | null;
  /** Set while a pairing code is live; the code itself is never readable again. */
  readonly pairingExpires: Date | null;
}

const SELECT = {
  id: true,
  name: true,
  status: true,
  tokenHash: true,
  shadowMode: true,
  appVersion: true,
  modelVersion: true,
  lastSeenAt: true,
  lastHeartbeat: true,
  pairingExpires: true,
} as const;

type Row = {
  id: string;
  name: string;
  status: string;
  tokenHash: string | null;
  shadowMode: boolean;
  appVersion: string | null;
  modelVersion: string | null;
  lastSeenAt: Date | null;
  lastHeartbeat: unknown;
  pairingExpires: Date | null;
};

const view = (row: Row): KioskDeviceView => ({
  id: row.id,
  name: row.name,
  status: row.status as 'ACTIVE' | 'REVOKED',
  paired: row.tokenHash !== null,
  shadowMode: row.shadowMode,
  appVersion: row.appVersion,
  modelVersion: row.modelVersion,
  lastSeenAt: row.lastSeenAt,
  lastHeartbeat: (row.lastHeartbeat as Record<string, unknown> | null) ?? null,
  pairingExpires: row.pairingExpires,
});

export class PrismaKioskDevices {
  readonly #prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async list(gymId: string): Promise<KioskDeviceView[]> {
    const rows = await this.#prisma.kioskDevice.findMany({ where: { gymId }, orderBy: { createdAt: 'asc' }, select: SELECT });
    return rows.map((row) => view(row as Row));
  }

  /**
   * Put a live pairing code on a phone, creating the row the first time.
   *
   * Re-issuing replaces the old code, which is what the owner means when they tap
   * "pair again" after the first code went stale.
   */
  async setPairingCode(gymId: string, deviceId: string | null, name: string, codeHash: string, expires: Date): Promise<string> {
    if (deviceId === null) {
      const created = await this.#prisma.kioskDevice.create({
        data: { gymId, name, status: 'ACTIVE', shadowMode: true, pairingCodeHash: codeHash, pairingExpires: expires },
        select: { id: true },
      });
      return created.id;
    }
    await this.#prisma.kioskDevice.update({
      where: { id: deviceId },
      // Pairing again replaces the token, so the old phone stops working the moment
      // the new one pairs — which is the point of pairing again.
      data: { name, pairingCodeHash: codeHash, pairingExpires: expires, tokenHash: null, status: 'ACTIVE' },
    });
    return deviceId;
  }

  async revoke(gymId: string, deviceId: string): Promise<void> {
    await this.#prisma.kioskDevice.updateMany({
      where: { id: deviceId, gymId },
      // The token is dropped immediately; the phone hears WIPE_AND_UNPAIR on its next
      // beat, but it has already lost its access by then.
      data: { status: 'REVOKED', tokenHash: null, pairingCodeHash: null, pairingExpires: null, revokedAt: new Date() },
    });
  }

  async setShadowMode(gymId: string, deviceId: string, shadowMode: boolean): Promise<void> {
    await this.#prisma.kioskDevice.updateMany({ where: { id: deviceId, gymId }, data: { shadowMode } });
  }

  /**
   * Paired, active phones with the last time each was reported quiet (BR-12).
   *
   * "When was the owner last told" comes from the alerts themselves rather than a
   * column, because the alert *is* the record that they were told. Only the last day
   * is read: an alert older than that cannot stop today's.
   */
  async offlineCandidates(gymId: string, since: Date): Promise<Array<{ id: string; name: string; lastSeenAt: Date | null; alertedAt: Date | null }>> {
    const [devices, alerts] = await Promise.all([
      this.#prisma.kioskDevice.findMany({
        where: { gymId, status: 'ACTIVE', tokenHash: { not: null } },
        select: { id: true, name: true, lastSeenAt: true },
      }),
      this.#prisma.alert.findMany({
        where: { gymId, type: 'KIOSK_OFFLINE', createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        select: { params: true, createdAt: true },
      }),
    ]);

    const lastAlert = new Map<string, Date>();
    for (const alert of alerts) {
      const deviceId = (alert.params as { deviceId?: unknown } | null)?.deviceId;
      if (typeof deviceId !== 'string') continue;
      if (!lastAlert.has(deviceId)) lastAlert.set(deviceId, alert.createdAt);
    }

    return devices.map((device) => ({ ...device, alertedAt: lastAlert.get(device.id) ?? null }));
  }

  /** The device behind a bearer token, or null. Looked up by hash; the token is never stored. */
  async byToken(token: string, pepper: string): Promise<{ id: string; gymId: string; status: 'ACTIVE' | 'REVOKED'; shadowMode: boolean } | null> {
    const row = await this.#prisma.kioskDevice.findFirst({
      where: { tokenHash: hashDeviceToken(token, pepper) },
      select: { id: true, gymId: true, status: true, shadowMode: true },
    });
    return row === null ? null : { id: row.id, gymId: row.gymId, status: row.status, shadowMode: row.shadowMode };
  }

  /** The store the `pairKioskDevice` service writes through. */
  pairingStore(): PairingStore {
    const prisma = this.#prisma;
    return {
      async findByPairingCodeHash(hash) {
        const row = await prisma.kioskDevice.findFirst({
          where: { pairingCodeHash: hash },
          select: { id: true, gymId: true, pairingCodeHash: true, pairingExpires: true, status: true },
        });
        return row === null ? null : { ...row, status: row.status };
      },

      async completePairing(deviceId, fields) {
        // Conditional on the code still being there, so two phones racing on the same
        // code cannot both pair: the second update matches nothing.
        const result = await prisma.kioskDevice.updateMany({
          where: { id: deviceId, pairingCodeHash: { not: null } },
          data: {
            tokenHash: fields.tokenHash,
            pairingCodeHash: null,
            pairingExpires: null,
            appVersion: fields.appVersion,
            modelVersion: fields.modelVersion,
            lastSeenAt: new Date(),
          },
        });
        return result.count === 1;
      },
    };
  }

  /** The store the heartbeat service writes through. */
  heartbeatStore(): HeartbeatStore {
    const prisma = this.#prisma;
    return {
      async device(deviceId) {
        const row = await prisma.kioskDevice.findUnique({ where: { id: deviceId }, select: { id: true, gymId: true, status: true, shadowMode: true } });
        return row === null ? null : { id: row.id, gymId: row.gymId, status: row.status, shadowMode: row.shadowMode };
      },

      async save(deviceId, at, health) {
        await prisma.kioskDevice.update({
          where: { id: deviceId },
          data: { lastSeenAt: at, lastHeartbeat: health as Prisma.InputJsonValue },
        });
      },
    };
  }
}
