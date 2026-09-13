import { DomainError, needsDeskPriceConfirmation, planCards, renewalStartDate, verifyTokenOrThrow, type PlanCardView } from '@mfp/core';
import { PrismaSignupReader } from '@mfp/db';
import { todayIST, type Gender, type ISTDate } from '@mfp/shared';
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
  const rows = await prisma.plan.findMany({
    where: { gymId: gym.id, isActive: true },
    select: { id: true, code: true, durationMonths: true, gender: true, pricePaise: true, isActive: true, sortOrder: true },
  });
  const plans = rows.map((row) => row as Parameters<typeof planCards>[0][number]);

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
