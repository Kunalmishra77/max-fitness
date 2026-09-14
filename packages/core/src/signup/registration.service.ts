import { todayIST, type Clock, type E164Mobile, type Gender, type ISTDate, type Language, type RegistrationFields } from '@mfp/shared';
import type { StorageDriver, StoredObject } from '../ports/storage';
import { issueToken } from '../tokens/signed-links';
import { autoConvertWindowStart } from '../leads/lead.rules';
import { assessAge, registrationConsents, type RegistrationConsentType } from './registration.rules';

/**
 * Online registration (PRD SU-02…SU-09; api-specification.md `POST /registrations`).
 *
 * Creates a member in `PENDING_PAYMENT` with their selfie and consent records, and
 * returns a signed token that lets the same browser continue to the plan and payment
 * steps without an account. Enrolment for face attendance is not started here: it is
 * queued only when a payment confirms (signup-and-payment-flow.md §2.6), so unpaid
 * sign-ups never reach the kiosk.
 *
 * The selfie is stored before the transaction (object storage cannot join a database
 * transaction) and deleted again if the transaction fails, so a failed registration
 * leaves no orphaned photo behind.
 */

/** PRD SU-09: the continuation token is valid for 48 hours. */
export const REGISTRATION_TOKEN_TTL_SECONDS = 48 * 3600;

/** Where the consent was given; stored on every consent row (privacy plan §4). */
export type RegistrationChannel = 'web_signup' | 'qr' | 'crm_desk';
export type RegistrationSource = 'WEBSITE' | 'QR_NEW' | 'WALK_IN';

/** A selfie already re-encoded by the image pipeline: JPEG, metadata stripped. */
export interface SelfieImage {
  readonly body: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface NewMemberRecord {
  readonly gymId: string;
  readonly fullName: string;
  readonly mobile: E164Mobile;
  readonly email: string | null;
  readonly dob: ISTDate;
  readonly gender: Gender;
  readonly language: Language;
  readonly status: 'PENDING_PAYMENT';
  readonly source: RegistrationSource;
  /** The staff member who typed it in at the desk; `null` when the member signed up themselves. */
  readonly createdById: string | null;
  readonly isMinor: boolean;
  readonly whatsappOptIn: boolean;
  readonly faceConsent: boolean;
}

export interface SelfieMediaRecord {
  readonly gymId: string;
  readonly memberId: string;
  readonly stored: StoredObject;
  readonly width: number;
  readonly height: number;
}

export interface ConsentRecord {
  readonly gymId: string;
  readonly memberId: string;
  readonly type: RegistrationConsentType;
  readonly granted: boolean;
  readonly noticeVersion: string;
  readonly channel: RegistrationChannel;
  /** The staff member who took a consent at the desk; `null` online. */
  readonly recordedById: string | null;
  /** Hashed, never the raw address (privacy plan §4). */
  readonly ipHash: string | null;
  readonly userAgent: string | null;
}

/**
 * BR-10.2: someone who enquired and then registers is the same person arriving twice.
 * Every enquiry from the same number in the window, not already converted, becomes this
 * member — a lost one included, since joining is the fact that matters.
 */
export interface LeadConversion {
  readonly gymId: string;
  readonly mobile: E164Mobile;
  /** Enquiries made on or after this moment count. */
  readonly since: Date;
  readonly memberId: string;
  readonly at: Date;
}

export interface RegistrationStore {
  /** Same mobile and same name, case-insensitive — a hint only; families share numbers (SU-08). */
  countMembersWithMobileAndName(gymId: string, mobile: E164Mobile, fullName: string): Promise<number>;
  createMember(record: NewMemberRecord): Promise<string>;
  createSelfieMedia(record: SelfieMediaRecord): Promise<string>;
  setMemberPhoto(memberId: string, mediaId: string): Promise<void>;
  createConsents(records: readonly ConsentRecord[]): Promise<void>;
  /** Converts the matching enquiries and closes their open `NEW_LEAD` calls; returns how many. */
  convertLeadsForMobile(conversion: LeadConversion): Promise<number>;
}

export interface RegistrationUnitOfWork {
  transaction<T>(work: (store: RegistrationStore) => Promise<T>): Promise<T>;
}

export interface RegistrationDeps {
  readonly clock: Clock;
  readonly uow: RegistrationUnitOfWork;
  readonly storage: StorageDriver;
  readonly tokenSecret: string;
  readonly gymId: string;
  /** `privacy.minAge` from settings (BR-12.2). */
  readonly minAge: number;
  readonly channel: RegistrationChannel;
  readonly source: RegistrationSource;
  readonly ipHash: string | null;
  readonly userAgent: string | null;
}

export interface RegistrationResult {
  readonly memberId: string;
  readonly registrationToken: string;
  readonly isMinor: boolean;
  readonly possibleDuplicate: boolean;
}

export async function registerMember(
  fields: RegistrationFields,
  selfie: SelfieImage,
  deps: RegistrationDeps,
): Promise<RegistrationResult> {
  // Refuse before storing anything: an under-age applicant's photo is never kept.
  const { isMinor } = assessAge({ dob: fields.dob, today: todayIST(deps.clock), minAge: deps.minAge });
  const consent = registrationConsents({ consents: fields.consents, isMinor });

  const stored = await deps.storage.put({ body: selfie.body, mimeType: 'image/jpeg', prefix: 'selfies' });

  let created: { memberId: string; possibleDuplicate: boolean };
  try {
    created = await deps.uow.transaction(async (store) => {
      const matches = await store.countMembersWithMobileAndName(deps.gymId, fields.mobile, fields.fullName);

      const memberId = await store.createMember({
        gymId: deps.gymId,
        fullName: fields.fullName,
        mobile: fields.mobile,
        email: fields.email ?? null,
        dob: fields.dob,
        gender: fields.gender,
        language: fields.language,
        status: 'PENDING_PAYMENT',
        source: deps.source,
        createdById: null,
        isMinor,
        whatsappOptIn: consent.whatsappOptIn,
        faceConsent: consent.faceConsent,
      });

      const mediaId = await store.createSelfieMedia({
        gymId: deps.gymId,
        memberId,
        stored,
        width: selfie.width,
        height: selfie.height,
      });
      await store.setMemberPhoto(memberId, mediaId);

      await store.createConsents(
        consent.rows.map((row) => ({
          gymId: deps.gymId,
          memberId,
          type: row.type,
          granted: row.granted,
          noticeVersion: fields.noticeVersion,
          channel: deps.channel,
          recordedById: null,
          ipHash: deps.ipHash,
          userAgent: deps.userAgent,
        })),
      );

      const now = deps.clock.now();
      await store.convertLeadsForMobile({ gymId: deps.gymId, mobile: fields.mobile, since: autoConvertWindowStart(now), memberId, at: now });

      return { memberId, possibleDuplicate: matches > 0 };
    });
  } catch (error) {
    // Best effort: the original failure is what the caller needs to see.
    await deps.storage.delete(stored.key).catch(() => undefined);
    throw error;
  }

  const registrationToken = issueToken({
    purpose: 'registration',
    subject: created.memberId,
    ttlSeconds: REGISTRATION_TOKEN_TTL_SECONDS,
    secret: deps.tokenSecret,
    clock: deps.clock,
  });

  return { memberId: created.memberId, registrationToken, isMinor, possibleDuplicate: created.possibleDuplicate };
}
