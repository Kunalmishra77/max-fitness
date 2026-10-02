import { getTranslations } from 'next-intl/server';
import { can, mayAfterPinEntry } from '@mfp/core';
import { formatISTDateTime } from '@mfp/shared';
import { deleteBotDocumentAction, saveBotConfigAction, saveBotDocumentAction, testBotAction, unlockSettingsAction } from '@/app/crm/actions';
import { BottomNav, CrmHeader } from '@/components/crm/crm-chrome';
import { BotConsole, type BotDocumentRow, type BotReplyRow } from '@/components/crm/bot-console';
import { SettingsUnlock } from '@/components/crm/settings-forms';
import { maskMobile } from '@mfp/shared';
import { getContainer } from '@/lib/container';
import { botDeps, requireCrmContext } from '@/lib/crm';

/**
 * The WhatsApp assistant (ADR-090).
 *
 * The owner's, behind the PIN, like prices: what the bot says is what the gym says. The log at
 * the bottom is the part that pays for itself — it is where the owner sees what members
 * actually ask, which is how the knowledge base gets better.
 */

export const dynamic = 'force-dynamic';

export default async function CrmBotPage() {
  const { actor, gym } = await requireCrmContext();
  const t = await getTranslations('crm');
  const { clock, env } = getContainer();
  const now = clock.now();

  if (!mayAfterPinEntry(actor, 'settings.manage', now)) {
    return (
      <>
        <CrmHeader title={t('bot.title')} subtitle={t('menu.bot.desc')} back="/crm/more" />
        <p role="alert" className="m-4 rounded-panel bg-tint-fee-none-bg p-4 text-crm-body font-semibold text-brand-obsidian">
          {t('bot.notAllowed')}
        </p>
        <BottomNav active="more" />
      </>
    );
  }

  if (!can(actor, 'settings.manage', now)) {
    return (
      <>
        <CrmHeader title={t('bot.title')} subtitle={t('menu.bot.desc')} back="/crm/more" />
        <SettingsUnlock unlock={unlockSettingsAction} />
        <BottomNav active="more" />
      </>
    );
  }

  const { bot } = botDeps();
  const [config, documents, replies] = await Promise.all([bot.settings(gym.id), bot.documents(gym.id), bot.replies(gym.id)]);

  const documentRows: BotDocumentRow[] = documents.map((document) => ({
    id: document.id,
    title: document.title,
    body: document.body,
    sourceName: document.sourceName,
  }));

  const replyRows: BotReplyRow[] = replies.map((reply) => ({
    id: reply.id,
    question: reply.question,
    answer: reply.answer,
    status: reply.status,
    reason: reply.reason,
    isTest: reply.isTest,
    // Never a whole number in the CRM (CLAUDE.md §2.8); a name when we have one.
    who: reply.member?.fullName ?? (reply.isTest ? t('bot.testTag') : maskMobile(reply.mobile)),
    at: formatISTDateTime(reply.createdAt, actor.language),
  }));

  return (
    <>
      <CrmHeader title={t('bot.title')} subtitle={t('menu.bot.desc')} back="/crm/more" />
      <div className="p-4 pb-24 lg:p-0">
        <BotConsole
          config={config}
          documents={documentRows}
          replies={replyRows}
          aiReady={env.AI_API_KEY !== ''}
          saveConfig={saveBotConfigAction}
          saveDocument={saveBotDocumentAction}
          deleteDocument={deleteBotDocumentAction}
          test={testBotAction}
        />
      </div>
      <BottomNav active="more" />
    </>
  );
}
