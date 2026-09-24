import { randomInt } from 'node:crypto';
import {
  addDays,
  addMonthsClamped,
  compareISTDates,
  PLAN_DURATIONS,
  todayIST,
  type Clock,
  type E164Mobile,
  type Gender,
  type ISTDate,
  type Language,
  type PlanDurationMonths,
  type RegistrationFields,
} from '@mfp/shared';
import { DomainError } from '../errors';
import { validateGovId, type GovIdImage, type GovIdType } from './gov-id';
import type { StorageDriver, StoredObject } from '../ports/storage';
import type { ConsentRecord, SelfieImage } from '../signup/registration.service';
import { assessAge, registrationConsents } from '../signup/registration.rules';

/**
 * An existing member scans the reception QR (PRD QR-02…04; qr-onboarding-flow §3; BR-3.6, BR-13; ADR-058).
 *
 * The member says who they are and until when their fees are paid. Nothing they declare
 * is trusted: a `VerificationRequest` with a random reference code waits in the CRM's
 * verify queue, and staff check the code the member shows at the desk.
 *
 * - **The register first.** An imported member with the same mobile and name is the
 *   same person: the photo and consents join that record, and no second member is made.
 * - **One open request per person.** Scanning again returns the same reference and
 *   keeps no second photo.
 * - **Nothing is stored for a refusal.** Dates and amounts are checked before the photo
 *   is written; a failed transaction removes the photo again.
 *
 * No names are looked up for the member here: with OTP off, telling a stranger who is
 * registered on a number would leak it (ADR-058). The match happens on the server and is
 * shown to staff.
 */

/**
 * How far back a declared month-end may be (ADR-075).
 *
 * This was sixty days, on the reasoning that a longer lapse needs a conversation at
 * the desk. In a real gym it refused exactly the people the gym most wants back: a
 * member whose fees ran out in March, standing at reception in September, was told
 * only that their form "could not be sent". Staff verify every one of these anyway,
 * so the date is now allowed to be old and the desk is told it is old.
 */
const DECLARED_DAYS_BACK = 3 * 365;
/** No plan runs longer than twelve months. */
const DECLARED_MONTHS_AHEAD = 13;
const MAX_AMOUNT_PAISE = 100_000_000;
const CODE_ATTEMPTS = 20;

export interface QrMemberRecord {
  readonly gymId: string;
  readonly fullName: string;
  readonly mobile: E164Mobile;
  readonly email: string | null;
  /** When they first joined, if they remember. Plenty will not (ADR-074). */
  readonly joinedOn: ISTDate | null;
  readonly dob: ISTDate;
  readonly gender: Gender;
  readonly language: Language;
  readonly status: 'PENDING_VERIFICATION';
  readonly source: 'QR_EXISTING';
  readonly isMinor: boolean;
  readonly whatsappOptIn: boolean;
  readonly faceConsent: boolean;
}

export interface VerificationRequestRecord {
  readonly gymId: string;
  readonly memberId: string;
  readonly referenceCode: string;
  readonly declaredPlanMonths: PlanDurationMonths | null;
  readonly declaredEndDate: ISTDate;
  readonly declaredAmountPaise: number | null;
  /** Which card the photographs are of. The number itself is never stored (ADR-074). */
  readonly govIdType: GovIdType | null;
  readonly matchedImportMemberId: string | null;
}

export interface ExistingMemberStore {
  /** An imported, not-deleted member of this gym with this mobile and name (case and spacing ignored). */
  findImportedMember(
    gymId: string,
    mobile: E164Mobile,
    fullName: string,
  ): Promise<{ readonly id: string } | null>;
  /** The imported member with this id, only if it is on this mobile. */
  findImportedMemberById(
    gymId: string,
    mobile: E164Mobile,
    memberId: string,
  ): Promise<{ readonly id: string } | null>;
  /** An open request for the same mobile and name. */
  findPendingRequest(gymId: string, mobile: E164Mobile, fullName: string): Promise<{ readonly referenceCode: string } | null>;
  referenceCodeTaken(gymId: string, code: string): Promise<boolean>;
  createMember(record: QrMemberRecord): Promise<string>;
  /** The member confirmed themselves: their consents now count (ADR-009). */
  confirmImportedMember(memberId: string, values: { readonly whatsappOptIn: boolean; readonly faceConsent: boolean }): Promise<void>;
  createSelfieMedia(record: { readonly gymId: string; readonly memberId: string; readonly stored: StoredObject; readonly width: number; readonly height: number }): Promise<string>;
  /** A photograph of one side of a government ID, labelled so the desk knows which. */
  createGovIdMedia(record: {
    readonly gymId: string;
    readonly memberId: string;
    readonly label: string;
    readonly stored: StoredObject;
    readonly width: number;
    readonly height: number;
  }): Promise<string>;
  setMemberPhoto(memberId: string, mediaId: string): Promise<void>;
  createConsents(records: readonly ConsentRecord[]): Promise<void>;
  createVerificationRequest(record: VerificationRequestRecord): Promise<string>;
  createAlert(alert: { readonly gymId: string; readonly memberId: string; readonly params: Record<string, string> }): Promise<void>;
}

export interface ExistingMemberUnitOfWork {
  transaction<T>(work: (store: ExistingMemberStore) => Promise<T>): Promise<T>;
}

/** BR-13 / qr-onboarding-flow §3 step 7: the only range a declared month-end may take. */
export function assertDeclaredEndDate(date: ISTDate, today: ISTDate, field: string): void {
  if (compareISTDates(date, addDays(today, -DECLARED_DAYS_BACK)) < 0 || compareISTDates(date, addMonthsClamped(today, DECLARED_MONTHS_AHEAD)) > 0) {
    throw new DomainError('VALIDATION_FAILED', 'The month-end date is out of range', { field });
  }
}

export async function submitExistingMember(
  input: {
    readonly fields: RegistrationFields;
    readonly selfie: SelfieImage;
    readonly declaredPlanMonths: PlanDurationMonths | null;
    readonly declaredEndDate: ISTDate;
    readonly declaredAmountPaise: number | null;
    /** Optional: plenty of members will not remember the day they joined. */
    readonly joinedOn: ISTDate | null;
    /** Photographs only — the number is never asked for or stored (ADR-074). */
    readonly govId: { readonly type: GovIdType; readonly images: readonly GovIdImage[] } | null;
    /**
     * The register entry the member picked after proving the number by OTP (ADR-060).
     * The caller passes it only with a valid OTP token for `fields.mobile`.
     */
    readonly claimedMemberId?: string;
  },
  deps: {
    readonly clock: Clock;
    readonly uow: ExistingMemberUnitOfWork;
    readonly storage: StorageDriver;
    readonly gymId: string;
    readonly minAge: number;
    readonly ipHash: string | null;
    readonly userAgent: string | null;
    /** Four digits for the reference code; injected in tests. */
    readonly randomCode?: () => number;
  },
): Promise<{ readonly referenceCode: string; readonly matchedExisting: boolean }> {
  const { fields } = input;
  const today = todayIST(deps.clock);

  assertDeclaredEndDate(input.declaredEndDate, today, 'declaredEndDate');
  if (input.declaredPlanMonths !== null && !(PLAN_DURATIONS as readonly number[]).includes(input.declaredPlanMonths)) {
    throw new DomainError('VALIDATION_FAILED', 'Plan length is 1, 3, 6 or 12 months', { field: 'declaredPlanMonths' });
  }
  const amount = input.declaredAmountPaise;
  if (amount !== null && (!Number.isInteger(amount) || amount < 0 || amount % 100 !== 0 || amount > MAX_AMOUNT_PAISE)) {
    throw new DomainError('VALIDATION_FAILED', 'The amount is whole rupees', { field: 'declaredAmountPaise' });
  }
  // The ID is checked before anything is written or uploaded, so a member who
  // photographed only one side of an Aadhaar leaves nothing behind in the bucket.
  if (input.govId !== null) {
    const verdict = validateGovId(input.govId.type, input.govId.images);
    if (!verdict.ok) throw new DomainError('VALIDATION_FAILED', `The ID photographs are not usable (${verdict.reason})`, { field: 'govId' });
  }

  // As for sign-up: an under-age applicant's photo is never kept.
  const { isMinor } = assessAge({ dob: fields.dob, today, minAge: deps.minAge });
  const consent = registrationConsents({ consents: fields.consents, isMinor });
  const draw = deps.randomCode ?? (() => randomInt(1000, 10000));

  const stored = await deps.storage.put({ body: input.selfie.body, mimeType: 'image/jpeg', prefix: 'selfies' });
  // ID photographs are more sensitive than the selfie, so they are tracked from the
  // moment they are uploaded and removed again on any failure below.
  const govIdStored: Array<{ label: string; stored: StoredObject; width: number; height: number }> = [];
  try {
    for (const image of input.govId?.images ?? []) {
      const object = await deps.storage.put({ body: image.body, mimeType: 'image/jpeg', prefix: 'gov-ids' });
      govIdStored.push({
        label: `${(input.govId?.type ?? '').toLowerCase()}-${image.side.toLowerCase()}`,
        stored: object,
        width: image.width,
        height: image.height,
      });
    }
  } catch (error) {
    await cleanUp(deps.storage, [stored, ...govIdStored.map((item) => item.stored)]);
    throw error;
  }

  let outcome: { referenceCode: string; matchedExisting: boolean; keptPhoto: boolean };
  try {
    outcome = await deps.uow.transaction(async (store) => {
      const pending = await store.findPendingRequest(deps.gymId, fields.mobile, fields.fullName);
      if (pending !== null) return { referenceCode: pending.referenceCode, matchedExisting: false, keptPhoto: false };

      const claimed =
        input.claimedMemberId === undefined
          ? null
          : await store.findImportedMemberById(deps.gymId, fields.mobile, input.claimedMemberId);
      const imported =
        claimed ?? (await store.findImportedMember(deps.gymId, fields.mobile, fields.fullName));
      let memberId: string;
      if (imported === null) {
        memberId = await store.createMember({
          gymId: deps.gymId,
          fullName: fields.fullName,
          mobile: fields.mobile,
          email: fields.email ?? null,
          joinedOn: input.joinedOn,
          dob: fields.dob,
          gender: fields.gender,
          language: fields.language,
          status: 'PENDING_VERIFICATION',
          source: 'QR_EXISTING',
          isMinor,
          whatsappOptIn: consent.whatsappOptIn,
          faceConsent: consent.faceConsent,
        });
      } else {
        memberId = imported.id;
        await store.confirmImportedMember(memberId, { whatsappOptIn: consent.whatsappOptIn, faceConsent: consent.faceConsent });
      }

      const mediaId = await store.createSelfieMedia({ gymId: deps.gymId, memberId, stored, width: input.selfie.width, height: input.selfie.height });
      await store.setMemberPhoto(memberId, mediaId);
      for (const image of govIdStored) {
        await store.createGovIdMedia({ gymId: deps.gymId, memberId, label: image.label, stored: image.stored, width: image.width, height: image.height });
      }
      await store.createConsents(
        consent.rows.map((row) => ({
          gymId: deps.gymId,
          memberId,
          type: row.type,
          granted: row.granted,
          noticeVersion: fields.noticeVersion,
          channel: 'qr' as const,
          recordedById: null,
          ipHash: deps.ipHash,
          userAgent: deps.userAgent,
        })),
      );

      let referenceCode: string | null = null;
      for (let attempt = 0; attempt < CODE_ATTEMPTS && referenceCode === null; attempt++) {
        const candidate = `Q-${draw()}`;
        if (!(await store.referenceCodeTaken(deps.gymId, candidate))) referenceCode = candidate;
      }
      if (referenceCode === null) throw new DomainError('CONFLICT', 'Could not find a free reference code');

      await store.createVerificationRequest({
        gymId: deps.gymId,
        memberId,
        referenceCode,
        declaredPlanMonths: input.declaredPlanMonths,
        declaredEndDate: input.declaredEndDate,
        declaredAmountPaise: amount,
        govIdType: input.govId?.type ?? null,
        matchedImportMemberId: imported?.id ?? null,
      });
      await store.createAlert({ gymId: deps.gymId, memberId, params: { referenceCode } });
      return { referenceCode, matchedExisting: imported !== null, keptPhoto: true };
    });
  } catch (error) {
    await cleanUp(deps.storage, [stored, ...govIdStored.map((item) => item.stored)]);
    throw error;
  }

  if (!outcome.keptPhoto) await cleanUp(deps.storage, [stored, ...govIdStored.map((item) => item.stored)]);
  return { referenceCode: outcome.referenceCode, matchedExisting: outcome.matchedExisting };
}

/**
 * Take back every object this attempt uploaded.
 *
 * A refusal must leave nothing behind, and ID photographs least of all — a bucket
 * quietly accumulating Aadhaar cards from failed submissions is the worst possible
 * shape for this feature to fail into.
 */
async function cleanUp(storage: StorageDriver, objects: readonly StoredObject[]): Promise<void> {
  for (const object of objects) {
    await storage.delete(object.key).catch(() => undefined);
  }
}
