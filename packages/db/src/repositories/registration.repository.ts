import type { RegistrationStore, RegistrationUnitOfWork } from '@mfp/core';
import { withTransaction, type PrismaClient, type TransactionClient } from '../client';
import { toDbDate } from '../dates';

/**
 * Prisma implementation of the registration unit of work: the member, their selfie
 * record and their consent rows commit together or not at all.
 */
export class PrismaRegistrationUnitOfWork implements RegistrationUnitOfWork {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  transaction<T>(work: (store: RegistrationStore) => Promise<T>): Promise<T> {
    return withTransaction(this.#prisma, (tx) => work(storeFor(tx)));
  }
}

function storeFor(tx: TransactionClient): RegistrationStore {
  return {
    countMembersWithMobileAndName(gymId, mobile, fullName) {
      return tx.member.count({
        where: { gymId, mobile, deletedAt: null, fullName: { equals: fullName, mode: 'insensitive' } },
      });
    },

    async createMember(record) {
      const created = await tx.member.create({
        data: {
          gymId: record.gymId,
          fullName: record.fullName,
          mobile: record.mobile,
          email: record.email,
          dob: toDbDate(record.dob),
          gender: record.gender,
          language: record.language,
          status: record.status,
          source: record.source,
          createdById: record.createdById,
          isMinor: record.isMinor,
          whatsappOptIn: record.whatsappOptIn,
          faceConsent: record.faceConsent,
        },
        select: { id: true },
      });
      return created.id;
    },

    async createSelfieMedia(record) {
      const created = await tx.mediaFile.create({
        data: {
          gymId: record.gymId,
          memberId: record.memberId,
          kind: 'SELFIE',
          storageKey: record.stored.key,
          mimeType: record.stored.mimeType,
          sizeBytes: record.stored.sizeBytes,
          sha256: record.stored.sha256,
          width: record.width,
          height: record.height,
        },
        select: { id: true },
      });
      return created.id;
    },

    async setMemberPhoto(memberId, mediaId) {
      await tx.member.update({ where: { id: memberId }, data: { photoMediaId: mediaId } });
    },

    async convertLeadsForMobile(conversion) {
      // BR-10.2. Ids first, because the call tasks are closed by lead id in the same step.
      const leads = await tx.lead.findMany({
        where: {
          gymId: conversion.gymId,
          mobile: conversion.mobile,
          createdAt: { gte: conversion.since },
          status: { not: 'CONVERTED' },
        },
        select: { id: true },
      });
      if (leads.length === 0) return 0;

      const ids = leads.map((lead) => lead.id);
      await tx.lead.updateMany({ where: { id: { in: ids } }, data: { status: 'CONVERTED', convertedMemberId: conversion.memberId } });
      await tx.callTask.updateMany({
        where: { leadId: { in: ids }, reason: 'NEW_LEAD', status: 'OPEN' },
        data: { status: 'DONE', doneAt: conversion.at },
      });
      return ids.length;
    },

    async createConsents(records) {
      await tx.consent.createMany({
        data: records.map((r) => ({
          gymId: r.gymId,
          memberId: r.memberId,
          type: r.type,
          granted: r.granted,
          noticeVersion: r.noticeVersion,
          channel: r.channel,
          recordedById: r.recordedById,
          ipHash: r.ipHash,
          userAgent: r.userAgent,
        })),
      });
    },
  };
}
