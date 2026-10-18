import { DomainError, needsDeskPriceConfirmation, planCards, renewalStartDate, verifyTokenOrThrow, type PlanCardView, type PlanCode } from '@mfp/core';
import { PrismaSignupReader } from '@mfp/db';
import { todayIST, type Gender, type ISTDate, type PlanDurationMonths } from '@mfp/shared';
import type { Container } from './container';
import { loadGym } from './gym';

/**
 * What a renew link offers (api-specification.md `GET /renew/{token}`; BR-3.4).
 *
 * Shared by the API route and the `/renew/[token]` page so they cannot disagree. The
 * proposed start date is for display; `/checkout/orders` applies the same rule again
 * when the member pays.
 */

/** Signed media URLs are capped at 5 minutes for images (security-plan.md §6). */
const PHOTO_URL_TTL_SECONDS = 300;

export interface RenewalOffer {
  readonly firstName: string;
  readonly photoUrl: string | null;
  readonly gender: Gender;
  readonly currentEndDate: ISTDate | null;
  readonly proposedStartDate: ISTDate;
  readonly cards: readonly PlanCardView[];
  readonly deskConfirmsPrice: boolean;
}

export async function loadRenewalOffer(container: Container, token: string): Promise<RenewalOffer> {
  const { clock, env, prisma } = container;
  const memberId = verifyTokenOrThrow({ token, purpose: 'renew', secret: env.LINK_TOKEN_SECRET, clock });

  const member = await new PrismaSignupReader(prisma).renewalSubject(memberId);
  if (member === null) throw new DomainError('MEMBER_NOT_FOUND', 'No such member');
  if (member.status === 'BLOCKED') throw new DomainError('MEMBER_BLOCKED', 'Renew at the desk');
  if (member.status !== 'ACTIVE' && member.status !== 'LEFT') throw new DomainError('CONFLICT', 'Nothing to renew');

  const gym = await loadGym(container);
  /**
   * `kind` is selected, and the cast that used to stand here is gone.
   *
   * `planCards` keeps only `kind === 'MEMBERSHIP'` — personal training is priced on its
   * own card (ADR-087). This query did not ask for the column, so every row arrived with
   * `kind` undefined, the filter removed all of them, and **the renew page offered a
   * member no plans at all.** Live from 2026-10-02 to 2026-10-18: every renewal link the
   * reminder engine sent led to a page nobody could renew from. The desk's own renew
   * screen was fine, because it selects the column, so nothing at the gym ever showed it.
   *
   * The cast is why the compiler stayed quiet. Without it the missing field is a type
   * error, which is the only guard that holds for the next column somebody adds.
   */
  const rows = await prisma.plan.findMany({
    where: { gymId: gym.id, isActive: true },
    select: { id: true, code: true, kind: true, durationMonths: true, gender: true, pricePaise: true, isActive: true, sortOrder: true },
  });
  /**
   * Three fields are narrowed, and nothing else is asserted.
   *
   * The database stores a plan's code as text, its duration as an integer and its gender
   * as the full member enum; the domain types each as the set of values it actually
   * accepts, and a plan is never priced for `OTHER`. Those three are the real difference
   * between the row and the type.
   *
   * **Everything else is checked, which is the point.** The old `row as Plan` asserted
   * the entire row, and so asserted away the `kind` column this query was not selecting.
   */
  const plans = rows.map((row) => ({
    ...row,
    code: row.code as PlanCode,
    durationMonths: row.durationMonths as PlanDurationMonths,
    gender: row.gender as 'MALE' | 'FEMALE',
  }));

  return {
    firstName: member.firstName,
    photoUrl: member.photoKey === null ? null : await container.storage.signedUrl(member.photoKey, PHOTO_URL_TTL_SECONDS),
    gender: member.gender,
    currentEndDate: member.latestConfirmedEndDate,
    proposedStartDate: renewalStartDate({
      currentEndDate: member.latestConfirmedEndDate,
      paymentDate: todayIST(clock),
      renewalGraceDays: gym.settings.membership.renewalGraceDays,
    }),
    cards: planCards(plans, member.gender, gym.settings.pricing),
    deskConfirmsPrice: needsDeskPriceConfirmation(member.gender, gym.settings.pricing.otherGenderPricing),
  };
}
