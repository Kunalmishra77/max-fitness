import type { OtpPurpose, OtpRecord, OtpStore, QrLookupRecord } from '@mfp/core';
import type { E164Mobile } from '@mfp/shared';
import type { PrismaClient } from '../client';
import { fromDbDate } from '../dates';

/**
 * One-time codes and the register lookup behind them (ADR-060).
 *
 * Only a keyed hash of each code is stored. Using a code is a conditional update, so two
 * requests with the same right code cannot both get a token.
 */
export class PrismaOtpStore implements OtpStore {
  readonly #prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  countSince(gymId: string, mobile: E164Mobile, purpose: OtpPurpose, since: Date): Promise<number> {
    return this.#prisma.otpCode.count({ where: { gymId, mobile, purpose, createdAt: { gt: since } } });
  }

  async create(row: {
    gymId: string;
    mobile: E164Mobile;
    purpose: OtpPurpose;
    codeHash: string;
    expiresAt: Date;
    createdAt: Date;
  }): Promise<void> {
    await this.#prisma.otpCode.create({ data: row });
  }

  async latestOpen(
    gymId: string,
    mobile: E164Mobile,
    purpose: OtpPurpose,
    now: Date,
  ): Promise<OtpRecord | null> {
    // The newest code only: sending a new one retires the ones before it.
    const row = await this.#prisma.otpCode.findFirst({
      where: { gymId, mobile, purpose },
      orderBy: { createdAt: 'desc' },
      select: { id: true, codeHash: true, attempts: true, consumedAt: true, expiresAt: true },
    });
    if (row === null || row.consumedAt !== null || row.expiresAt <= now) return null;
    return row;
  }

  async recordFailedAttempt(id: string): Promise<void> {
    await this.#prisma.otpCode.update({ where: { id }, data: { attempts: { increment: 1 } } });
  }

  async consume(id: string, at: Date): Promise<boolean> {
    const { count } = await this.#prisma.otpCode.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: at },
    });
    return count === 1;
  }
}

/** Register entries on a proven number: imported members not yet confirmed by QR. */
export class PrismaQrLookup {
  readonly #prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async candidates(gymId: string, mobile: E164Mobile): Promise<QrLookupRecord[]> {
    const rows = await this.#prisma.member.findMany({
      where: { gymId, mobile, source: 'IMPORT', deletedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 5,
      select: {
        id: true,
        fullName: true,
        memberships: {
          where: { source: 'IMPORT', isDeclared: true, status: 'CONFIRMED' },
          orderBy: { endDate: 'desc' },
          take: 1,
          select: { endDate: true, durationMonths: true },
        },
      },
    });
    return rows.map((row) => {
      const membership = row.memberships[0];
      return {
        memberId: row.id,
        fullName: row.fullName,
        planMonths: membership?.durationMonths ?? null,
        endDate: membership === undefined ? null : fromDbDate(membership.endDate),
      };
    });
  }
}
