import type { CrmActor, ElevationStore, LoginStore, NewSessionRecord, StaffForElevation, StaffForLogin } from '@mfp/core';
import { elevationExpiry, sessionTokenHash } from '@mfp/core';
import type { PrismaClient } from '../client';

/**
 * Staff sign-in and sessions (security-plan.md §3.1).
 *
 * Sessions are looked up by the SHA-256 of the token the browser holds, never by the
 * token itself, and an expired or revoked row simply does not resolve to an actor.
 */
export class PrismaCrmAuthStore implements LoginStore {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async findStaffByMobile(gymId: string, mobile: string): Promise<StaffForLogin | null> {
    const staff = await this.#prisma.staffUser.findFirst({
      where: { gymId, mobile },
      select: {
        id: true,
        gymId: true,
        name: true,
        role: true,
        language: true,
        pinHash: true,
        isActive: true,
        failedPinCount: true,
        lockedUntil: true,
      },
    });
    return staff;
  }

  async recordFailedPin(staffUserId: string, failedCount: number, lockedUntil: Date | null): Promise<void> {
    await this.#prisma.staffUser.update({ where: { id: staffUserId }, data: { failedPinCount: failedCount, lockedUntil } });
  }

  async clearFailedPins(staffUserId: string, lastLoginAt: Date): Promise<void> {
    await this.#prisma.staffUser.update({
      where: { id: staffUserId },
      data: { failedPinCount: 0, lockedUntil: null, lastLoginAt },
    });
  }

  async createSession(record: NewSessionRecord): Promise<void> {
    await this.#prisma.session.create({ data: { ...record } });
  }
}

/**
 * The PIN re-entry behind sensitive actions (security-plan.md §3.1).
 *
 * It reads and writes the same `failedPinCount`/`lockedUntil` columns the login screen
 * uses, so five wrong PINs lock the account whichever screen they were typed into.
 */
export class PrismaElevationStore implements ElevationStore {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async staffForElevation(staffUserId: string): Promise<StaffForElevation | null> {
    return await this.#prisma.staffUser.findUnique({
      where: { id: staffUserId },
      select: { pinHash: true, isActive: true, failedPinCount: true, lockedUntil: true },
    });
  }

  async recordFailedPin(staffUserId: string, failedCount: number, lockedUntil: Date | null): Promise<void> {
    await this.#prisma.staffUser.update({ where: { id: staffUserId }, data: { failedPinCount: failedCount, lockedUntil } });
  }

  async clearFailedPins(staffUserId: string): Promise<void> {
    await this.#prisma.staffUser.update({ where: { id: staffUserId }, data: { failedPinCount: 0, lockedUntil: null } });
  }

  async touchSession(token: string, now: Date): Promise<void> {
    await this.#prisma.session.updateMany({ where: { tokenHash: sessionTokenHash(token) }, data: { lastSeenAt: now } });
  }
}

export interface CrmSessionActor extends CrmActor {
  readonly name: string;
  readonly language: 'en' | 'hi';
}

/** Resolves the session cookie to an actor, or `null` when it is expired, revoked or unknown. */
export class PrismaCrmSessions {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async actorFor(token: string, now: Date, receptionMayTakePayments = true): Promise<CrmSessionActor | null> {
    const session = await this.#prisma.session.findUnique({
      where: { tokenHash: sessionTokenHash(token) },
      select: {
        expiresAt: true,
        revokedAt: true,
        lastSeenAt: true,
        staffUser: { select: { id: true, gymId: true, role: true, name: true, language: true, isActive: true } },
      },
    });
    if (session === null || session.revokedAt !== null || session.expiresAt.getTime() <= now.getTime()) return null;
    if (!session.staffUser.isActive) return null;

    return {
      staffUserId: session.staffUser.id,
      gymId: session.staffUser.gymId,
      role: session.staffUser.role,
      name: session.staffUser.name,
      language: session.staffUser.language,
      // Signing in counted as a PIN entry; it lapses a few minutes later (BR: PIN elevation).
      elevatedUntil: elevationExpiry(session.lastSeenAt),
      receptionMayTakePayments,
    };
  }

  async touch(token: string, now: Date): Promise<void> {
    await this.#prisma.session.updateMany({ where: { tokenHash: sessionTokenHash(token) }, data: { lastSeenAt: now } });
  }

  async revoke(token: string, now: Date): Promise<void> {
    await this.#prisma.session.updateMany({ where: { tokenHash: sessionTokenHash(token) }, data: { revokedAt: now } });
  }
}
