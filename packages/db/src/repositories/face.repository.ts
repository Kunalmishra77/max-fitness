import type { FaceTemplateRow } from '@mfp/core';
import type { PrismaClient } from '../client';
import { decryptVector, encryptVector } from '../field-encryption';

/**
 * Face templates: writing them, and reading the gallery the matcher works over (ADR-107).
 *
 * The vectors are encrypted in the column, so this is the only place they exist as numbers.
 * Everything above works in embeddings and scores and never sees a member's face.
 */

export interface StoredTemplate {
  readonly gymId: string;
  readonly memberId: string;
  readonly vector: readonly number[];
  readonly modelVersion: string;
  /**
   * What the photograph measured. Kept so a gallery can be audited later — "which members
   * were enrolled off a poor photograph" is the first question when somebody is not being
   * recognised.
   */
  readonly qualityScore: number;
  readonly sourceKind: 'signup_selfie' | 'assisted' | 'adaptive';
  readonly sourceMediaId?: string | null;
}

export class PrismaFaceTemplates {
  readonly #prisma: PrismaClient;
  readonly #key: Buffer;

  constructor(prisma: PrismaClient, key: Buffer) {
    this.#prisma = prisma;
    this.#key = key;
  }

  async save(template: StoredTemplate): Promise<{ id: string }> {
    return this.#prisma.faceTemplate.create({
      data: {
        gymId: template.gymId,
        memberId: template.memberId,
        // Prisma's Bytes is a Uint8Array over a plain ArrayBuffer; a Node Buffer may sit on
        // a shared one, which the types refuse. The copy is 544 bytes and happens once per
        // template, which is the right price for not widening the column's type.
        vectorEnc: new Uint8Array(encryptVector(template.vector, this.#key)),
        dimensions: template.vector.length,
        modelVersion: template.modelVersion,
        qualityScore: template.qualityScore,
        sourceKind: template.sourceKind,
        sourceMediaId: template.sourceMediaId ?? null,
      },
      select: { id: true },
    });
  }

  countFor(memberId: string): Promise<number> {
    return this.#prisma.faceTemplate.count({ where: { memberId, status: 'ACTIVE' } });
  }

  /**
   * Everybody the camera could be looking at.
   *
   * Scoped to one model version: a template made by a different engine is not comparable,
   * and scoring it would quietly make strangers look like members. The matcher also ignores
   * a vector of the wrong length, but filtering here means those rows are never decrypted.
   *
   * A member who has left keeps their membership record and loses their gallery entry the
   * moment they are no longer ACTIVE-or-pending — the door should not greet somebody the
   * register says is gone.
   */
  async gallery(gymId: string, modelVersion: string): Promise<FaceTemplateRow[]> {
    const rows = await this.#prisma.faceTemplate.findMany({
      where: {
        gymId,
        status: 'ACTIVE',
        modelVersion,
        member: { deletedAt: null, status: { in: ['ACTIVE', 'PENDING_PAYMENT', 'PENDING_VERIFICATION'] } },
      },
      select: { id: true, memberId: true, vectorEnc: true },
    });

    const gallery: FaceTemplateRow[] = [];
    for (const row of rows) {
      try {
        gallery.push({ id: row.id, memberId: row.memberId, vector: decryptVector(Buffer.from(row.vectorEnc), this.#key) });
      } catch {
        // One unreadable template must not take the whole door down. It is skipped, and the
        // member falls back to the keypad rather than everybody behind them doing so.
        continue;
      }
    }
    return gallery;
  }

  /** Who has no usable template yet, so the CRM can say who still needs a photograph. */
  async membersWithoutTemplates(gymId: string, modelVersion: string): Promise<Array<{ id: string; fullName: string; hasPhoto: boolean; faceConsent: boolean }>> {
    const members = await this.#prisma.member.findMany({
      where: {
        gymId,
        deletedAt: null,
        status: { in: ['ACTIVE', 'PENDING_PAYMENT', 'PENDING_VERIFICATION'] },
        faceTemplates: { none: { status: 'ACTIVE', modelVersion } },
      },
      select: { id: true, fullName: true, faceConsent: true, photo: { select: { deletedAt: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      id: m.id,
      fullName: m.fullName,
      hasPhoto: m.photo !== null && m.photo.deletedAt === null,
      faceConsent: m.faceConsent,
    }));
  }

  /** BR-6.6: a member who left loses their face, whatever else the register keeps. */
  async revokeFor(memberId: string, at: Date): Promise<number> {
    const { count } = await this.#prisma.faceTemplate.updateMany({
      where: { memberId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: at },
    });
    return count;
  }
}
