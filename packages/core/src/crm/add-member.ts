import { todayIST, type Clock, type RegistrationFields } from '@mfp/shared';
import type { StorageDriver, StoredObject } from '../ports/storage';
import { assessAge, registrationConsents } from '../signup/registration.rules';
import type { RegistrationUnitOfWork, SelfieImage } from '../signup/registration.service';
import { assertCan, type CrmActor } from './permissions';

/**
 * Adding a member at the desk (crm-ux-blueprint §7; PRD SU-02; BR-12).
 *
 * The walk-in half of registration: staff type what the member says, and the member is
 * created in `PENDING_PAYMENT` exactly as an online sign-up is — the desk flow then
 * continues straight to plan and payment, which confirms the membership and assigns the
 * member code. No continuation token is issued: nobody is leaving the counter.
 *
 * Two things differ from the website. **The photo is optional**, because a camera that
 * will not open must not stop someone joining; enrolment for face attendance is queued
 * on payment anyway, and only for a member who consented. And **the staff member is
 * recorded** — on the member as `createdById`, and on every consent row as
 * `recordedById`, because a consent taken across a counter should say who took it.
 *
 * The age and consent rules are the same functions the website uses, so "16 and over"
 * and "a minor's own tick is not enough for face attendance" cannot drift apart between
 * the two doors into the gym.
 */

export interface DeskRegistrationResult {
  readonly memberId: string;
  readonly isMinor: boolean;
  /** Same name and number as an existing member — a hint for staff, never a refusal (SU-08). */
  readonly possibleDuplicate: boolean;
}

export async function registerAtDesk(
  input: { readonly fields: RegistrationFields; readonly selfie?: SelfieImage | null },
  deps: {
    readonly actor: CrmActor;
    readonly clock: Clock;
    readonly uow: RegistrationUnitOfWork;
    readonly storage: StorageDriver;
    /** `privacy.minAge` from settings (BR-12.2). */
    readonly minAge: number;
  },
): Promise<DeskRegistrationResult> {
  const { actor, fields } = { actor: deps.actor, fields: input.fields };
  assertCan(actor, 'member.edit', deps.clock.now());

  // Refuse before storing anything: an under-age applicant's photo is never kept.
  const { isMinor } = assessAge({ dob: fields.dob, today: todayIST(deps.clock), minAge: deps.minAge });
  const consent = registrationConsents({ consents: fields.consents, isMinor });

  const selfie = input.selfie ?? null;
  const stored: StoredObject | null =
    selfie === null ? null : await deps.storage.put({ body: selfie.body, mimeType: 'image/jpeg', prefix: 'selfies' });

  try {
    return await deps.uow.transaction(async (store) => {
      const matches = await store.countMembersWithMobileAndName(actor.gymId, fields.mobile, fields.fullName);

      const memberId = await store.createMember({
        gymId: actor.gymId,
        fullName: fields.fullName,
        mobile: fields.mobile,
        email: fields.email ?? null,
        dob: fields.dob,
        gender: fields.gender,
        language: fields.language,
        status: 'PENDING_PAYMENT',
        source: 'WALK_IN',
        createdById: actor.staffUserId,
        isMinor,
        whatsappOptIn: consent.whatsappOptIn,
        faceConsent: consent.faceConsent,
      });

      if (stored !== null && selfie !== null) {
        const mediaId = await store.createSelfieMedia({
          gymId: actor.gymId,
          memberId,
          stored,
          width: selfie.width,
          height: selfie.height,
        });
        await store.setMemberPhoto(memberId, mediaId);
      }

      await store.createConsents(
        consent.rows.map((row) => ({
          gymId: actor.gymId,
          memberId,
          type: row.type,
          granted: row.granted,
          noticeVersion: fields.noticeVersion,
          channel: 'crm_desk' as const,
          recordedById: actor.staffUserId,
          // A consent given across the counter has no browser to record.
          ipHash: null,
          userAgent: null,
        })),
      );

      return { memberId, isMinor, possibleDuplicate: matches > 0 };
    });
  } catch (error) {
    // Best effort: the original failure is what the caller needs to see.
    if (stored !== null) await deps.storage.delete(stored.key).catch(() => undefined);
    throw error;
  }
}
