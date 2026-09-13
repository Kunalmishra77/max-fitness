import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { can, membershipEndDate, planCards, recordDeskPayment, renewalStartDate, type DeskPaymentMethod } from '@mfp/core';
import { CrmHeader } from '@/components/crm/crm-chrome';
import { RenewFlow } from '@/components/crm/renew-flow';
import { getContainer } from '@/lib/container';
import { deskPaymentDeps, requireCrmContext } from '@/lib/crm';

/**
 * Take fees in three taps: plan, method, confirm (crm-ux-blueprint §6).
 *
 * The prices and dates shown come from the domain; the confirm step calls
 * `recordDeskPayment`, which prices it again and writes the membership, the payment and
 * the receipt in one transaction. Permission is checked here and again in the service.
 */

export const dynamic = 'force-dynamic';

export default async function CrmRenewPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor, gym, today, reader } = await requireCrmContext();
  const t = await getTranslations('crm');
  const { clock, prisma } = getContainer();
  const { id } = await params;

  if (!can(actor, 'payment.record', clock.now())) {
    return (
      <>
        <CrmHeader title={t('renew.title')} back={`/crm/members/${id}`} />
        <p role="alert" className="m-4 rounded-panel bg-tint-fee-expired-bg p-4 text-crm-body font-semibold text-semantic-fee-expired">
          {t('renew.notAllowed')}
        </p>
      </>
    );
  }

  const member = await reader.member(gym.id, id, today);
  if (member === null) notFound();

  const planRows = await prisma.plan.findMany({
    where: { gymId: gym.id, isActive: true },
    select: { id: true, code: true, durationMonths: true, gender: true, pricePaise: true, isActive: true, sortOrder: true },
  });
  const cards = planCards(
    planRows.map((row) => row as Parameters<typeof planCards>[0][number]),
    member.gender,
    gym.settings.pricing,
  );

  // The renewal chains on from the current end date within the grace window (BR-3.4).
  const startDate = renewalStartDate({
    currentEndDate: member.effectiveEndDate,
    paymentDate: today,
    renewalGraceDays: gym.settings.membership.renewalGraceDays,
  });
  const isFirst = member.memberships.every((m) => m.status !== 'CONFIRMED');

  async function takePayment(planId: string, method: DeskPaymentMethod) {
    'use server';
    const context = await requireCrmContext();
    const result = await recordDeskPayment({ memberId: id, planId, method }, { actor: context.actor, ...deskPaymentDeps(context.gym) });
    redirect(`/crm/members/${id}/renew?done=${result.paymentId}&receipt=${encodeURIComponent(result.receiptNo)}&code=${encodeURIComponent(result.memberCode)}&amount=${result.amountPaise}`);
  }

  return (
    <>
      <CrmHeader title={t('renew.title')} back={`/crm/members/${id}`} />
      <RenewFlow
        memberName={member.fullName}
        plans={cards.map((card) => ({
          planId: card.planId,
          durationMonths: card.durationMonths,
          pricePaise: card.pricePaise + (isFirst ? gym.settings.pricing.admissionFeePaise : 0),
          endDate: membershipEndDate(startDate, card.durationMonths),
        }))}
        startDate={startDate}
        locale={actor.language}
        action={takePayment}
      />
    </>
  );
}
