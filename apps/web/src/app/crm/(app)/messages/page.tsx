import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { can } from '@mfp/core';
import { PrismaMessageLogReader } from '@mfp/db';
import { todayIST } from '@mfp/shared';
import { BottomNav, CrmHeader, pillClass } from '@/components/crm/crm-chrome';
import { MessageList, type MessageRow } from '@/components/crm/message-list';
import { getContainer } from '@/lib/container';
import { requireCrmContext } from '@/lib/crm';

/**
 * "मैसेज" — the WhatsApp log (crm-module-spec §8; whatsapp-automation-engine §10).
 *
 * Owner and reception read it; a trainer has no business seeing who was messaged about
 * money. The default view is everything from the last few days, with one tap to see only
 * what did not go out — which is the list the owner actually acts on.
 */

export const dynamic = 'force-dynamic';

export default async function CrmMessagesPage({ searchParams }: { searchParams: Promise<{ only?: string; member?: string }> }) {
  const { actor, gym } = await requireCrmContext();
  const t = await getTranslations('crm');
  const { clock, prisma } = getContainer();
  const { only, member } = await searchParams;

  if (!can(actor, 'member.view', clock.now())) {
    return (
      <>
        <CrmHeader title={t('messages.title')} back="/crm/more" />
        <p role="alert" className="m-4 rounded-panel bg-tint-fee-none-bg p-4 text-crm-body font-semibold text-brand-obsidian">
          {t('verify.errors.notAllowed')}
        </p>
        <BottomNav active="more" />
      </>
    );
  }

  const reader = new PrismaMessageLogReader(prisma);
  const failedOnly = only === 'failed';
  const [rows, counts] = await Promise.all([
    reader.list(gym.id, {
      ...(member === undefined ? {} : { memberId: member }),
      ...(failedOnly ? { status: 'SKIPPED' as const } : {}),
      limit: 100,
    }),
    reader.countsToday(gym.id, new Date(`${todayIST(clock)}T00:00:00+05:30`)),
  ]);

  // "Not sent" covers both the ones a rule skipped and the ones the provider refused.
  const failed = failedOnly ? rows : [];
  const alsoFailed = failedOnly ? await reader.list(gym.id, { status: 'FAILED', limit: 100 }) : [];
  const shown = failedOnly ? [...failed, ...alsoFailed].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) : rows;

  const view: MessageRow[] = shown.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    memberName: row.memberName,
    direction: row.direction,
    purpose: row.purpose,
    status: row.status,
    ruleCode: row.ruleCode,
    bodyPreview: row.bodyPreview,
    errorCode: row.errorCode,
    at: row.createdAt.toISOString(),
  }));

  const sentToday = (counts['SENT'] ?? 0) + (counts['DELIVERED'] ?? 0) + (counts['READ'] ?? 0) + (counts['SIMULATED'] ?? 0);
  const notSentToday = (counts['SKIPPED'] ?? 0) + (counts['FAILED'] ?? 0);

  return (
    <>
      <CrmHeader title={t('messages.title')} subtitle={t('messages.helper')} back="/crm/more" />
      <div className="grid gap-4 p-4 lg:p-0">
        <p className="text-small text-brand-stone">{t('messages.today', { sent: sentToday, skipped: notSentToday })}</p>
        <div className="flex gap-2">
          <Link href="/crm/messages" className={pillClass(!failedOnly)}>
            {t('messages.filterAll')}
          </Link>
          <Link href="/crm/messages?only=failed" className={pillClass(failedOnly)}>
            {t('messages.filterFailed')}
          </Link>
          <Link
            href="/crm/messages/simulator"
            className="ml-auto inline-flex min-h-11 items-center rounded-full border border-brand-stone/25 px-4 text-small font-semibold text-brand-obsidian hover:border-brand-accent hover:text-brand-accent"
          >
            {t('simulator.open')}
          </Link>
        </div>
      </div>
      <MessageList rows={view} />
      <BottomNav active="more" />
    </>
  );
}
