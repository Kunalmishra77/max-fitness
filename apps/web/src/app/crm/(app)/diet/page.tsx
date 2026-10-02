import { getTranslations } from 'next-intl/server';
import { can } from '@mfp/core';
import { regenerateDietPlanAction, startDietPlansAction } from '@/app/crm/actions';
import { BottomNav, CrmHeader } from '@/components/crm/crm-chrome';
import { DietBoard, type DietCandidate, type DietRow } from '@/components/crm/diet-board';
import { formatISTDate, toISTDate } from '@mfp/shared';
import { getContainer } from '@/lib/container';
import { dietReader, requireCrmContext } from '@/lib/crm';

/**
 * Diet plans (ADR-089).
 *
 * The owner picks members and the questions go out; the answers come back over WhatsApp and
 * the plan is written when there is enough to write one. This screen is the picking and the
 * watching — it never writes a plan from nothing.
 */

export const dynamic = 'force-dynamic';

export default async function CrmDietPage() {
  const { actor, gym } = await requireCrmContext();
  const t = await getTranslations('crm');
  const { clock, env, prisma } = getContainer();

  if (!can(actor, 'diet.manage', clock.now())) {
    return (
      <>
        <CrmHeader title={t('diet.title')} subtitle={t('menu.diet.desc')} back="/crm/more" />
        <p role="alert" className="m-4 rounded-panel bg-tint-fee-expired-bg p-4 text-crm-body font-semibold text-semantic-fee-expired">
          {t('diet.notAllowed')}
        </p>
        <BottomNav active="more" />
      </>
    );
  }

  const reader = dietReader();
  const [overview, members, failures] = await Promise.all([
    reader.overview.overview(gym.id),
    // Only members who could actually be asked: the rest would be skipped anyway.
    prisma.member.findMany({
      where: { gymId: gym.id, deletedAt: null, status: 'ACTIVE', whatsappOptIn: true, remindersUnsubscribedAt: null },
      select: { id: true, fullName: true, memberCode: true },
      orderBy: { fullName: 'asc' },
      take: 500,
    }),
    // The reason a failed plan failed, which the overview does not carry.
    prisma.dietPlan.findMany({ where: { gymId: gym.id, status: 'FAILED' }, select: { memberId: true, version: true, failureReason: true }, orderBy: { version: 'desc' } }),
  ]);

  const reasonByMember = new Map<string, string | null>();
  for (const row of failures) if (!reasonByMember.has(row.memberId)) reasonByMember.set(row.memberId, row.failureReason);

  const rows: DietRow[] = overview.map((row) => ({
    memberId: row.memberId,
    fullName: row.fullName,
    memberCode: row.memberCode,
    version: row.version,
    planStatus: row.planStatus,
    failureReason: row.planStatus === 'FAILED' ? (reasonByMember.get(row.memberId) ?? null) : null,
    goal: row.goal,
    dietType: row.dietType,
    bmi: row.bmiTenths === null ? null : (row.bmiTenths / 10).toFixed(1),
    generatedOn: row.generatedAt === null ? null : formatISTDate(toISTDate(row.generatedAt), actor.language),
    pendingQuestion: row.pendingQuestion,
  }));

  const candidates: DietCandidate[] = members.map((member) => ({ memberId: member.id, fullName: member.fullName, memberCode: member.memberCode }));

  return (
    <>
      <CrmHeader title={t('diet.title')} subtitle={t('menu.diet.desc')} back="/crm/more" />
      <div className="p-4 pb-24 lg:p-0">
        <DietBoard rows={rows} candidates={candidates} aiReady={env.AI_API_KEY !== ''} start={startDietPlansAction} regenerate={regenerateDietPlanAction} />
      </div>
      <BottomNav active="more" />
    </>
  );
}
