import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { can } from '@mfp/core';
import { PrismaMessageLogReader } from '@mfp/db';
import { formatISTDate, todayIST, toISTDate } from '@mfp/shared';
import { BottomNav, CrmHeader, CRM_CARD, pillClass } from '@/components/crm/crm-chrome';
import { MessageList, type MessageRow } from '@/components/crm/message-list';
import { AutoRefresh } from '@/components/crm/auto-refresh';
import { cn } from '@/lib/cn';
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

export default async function CrmMessagesPage({ searchParams }: { searchParams: Promise<{ only?: string; member?: string; view?: string }> }) {
  const { actor, gym } = await requireCrmContext();
  const t = await getTranslations('crm');
  const { clock, prisma } = getContainer();
  const { only, member, view: viewMode } = await searchParams;
  // One member's thread is a thread, not the people list (ADR-091).
  const byPerson = viewMode === 'people' && member === undefined;

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
  const conversations = byPerson ? await reader.conversations(gym.id) : [];

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

  // Whose thread this is. Opening one from the people list used to leave the screen headed
  // "Messages" with no way back to the list it came from.
  const threadName = member === undefined ? null : (rows.find((row) => row.memberName !== null)?.memberName ?? null);

  const sentToday = (counts['SENT'] ?? 0) + (counts['DELIVERED'] ?? 0) + (counts['READ'] ?? 0) + (counts['SIMULATED'] ?? 0);
  const notSentToday = (counts['SKIPPED'] ?? 0) + (counts['FAILED'] ?? 0);

  return (
    <>
      {/* A reply or a delivery report arrives without anybody asking (ADR-092). */}
      <AutoRefresh seconds={60} />
      <CrmHeader
        title={threadName === null ? t('messages.title') : t('messages.threadOf', { name: threadName })}
        {...(threadName === null ? { subtitle: t('messages.helper') } : {})}
        back={member === undefined ? '/crm/more' : '/crm/messages?view=people'}
      />
      <div className="grid gap-4 p-4 lg:p-0">
        <p className="text-small text-brand-stone">{t('messages.today', { sent: sentToday, skipped: notSentToday })}</p>
        <div className="flex flex-wrap gap-2">
          {member === undefined ? null : (
            <Link href="/crm/messages?view=people" className={pillClass(false)}>
              {t('messages.backToPeople')}
            </Link>
          )}
          <Link href="/crm/messages" className={pillClass(!failedOnly && !byPerson && member === undefined)}>
            {t('messages.filterAll')}
          </Link>
          {/* A gym thinks in people, not in a stream of sends (ADR-091). */}
          <Link href="/crm/messages?view=people" className={pillClass(byPerson)}>
            {t('messages.filterPeople')}
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
      {byPerson ? (
        <ul className={cn(CRM_CARD, 'mx-4 overflow-hidden lg:mx-0')}>
          {conversations.length === 0 ? (
            <li className="px-4 py-8 text-center text-crm-body text-brand-stone">{t('messages.noPeople')}</li>
          ) : (
            conversations.map((conversation) => (
              <li key={conversation.memberId}>
                <Link
                  href={`/crm/messages?member=${conversation.memberId}`}
                  className="flex min-h-16 items-center gap-3 border-b border-brand-stone/15 px-4 py-3 transition-colors last:border-0 hover:bg-brand-paper"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-crm-body font-semibold text-brand-obsidian">
                      {conversation.memberName ?? t('messages.unknownMember')}
                    </span>
                    <span className="block truncate text-small text-brand-stone">
                      {conversation.lastDirection === 'INBOUND' ? `↩ ${conversation.lastPreview ?? ''}` : (conversation.lastPreview ?? '')}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-small text-brand-stone">{formatISTDate(toISTDate(conversation.lastAt), actor.language)}</span>
                    <span className="block text-small text-brand-stone">{t('messages.count', { count: conversation.messages })}</span>
                  </span>
                  {conversation.hasInbound ? (
                    <span className="shrink-0 rounded-full bg-brand-accent px-2.5 py-0.5 text-small font-bold text-brand-white">{t('messages.replied')}</span>
                  ) : null}
                </Link>
              </li>
            ))
          )}
        </ul>
      ) : (
        <MessageList rows={view} />
      )}
      <BottomNav active="more" />
    </>
  );
}
