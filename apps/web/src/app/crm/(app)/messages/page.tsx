import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { can, serviceWindow } from '@mfp/core';
import { PrismaMessageLogReader } from '@mfp/db';
import { formatISTDate, todayIST } from '@mfp/shared';
import { AutoRefresh } from '@/components/crm/auto-refresh';
import { BottomNav, CrmHeader, CRM_CARD, FEE_TONE, pillClass } from '@/components/crm/crm-chrome';
import { CrmIcon } from '@/components/crm/crm-icons';
import { InboxList, type InboxRow } from '@/components/crm/inbox-list';
import { InboxThread, type ThreadMessage } from '@/components/crm/inbox-thread';
import { MessageList, type MessageRow } from '@/components/crm/message-list';
import { cn } from '@/lib/cn';
import { getContainer } from '@/lib/container';
import { requireCrmContext } from '@/lib/crm';
import { displayPhone } from '@/lib/site';

/**
 * Messages — an inbox, not a stream (crm-module-spec §8; ADR-091, ADR-126, ADR-128).
 *
 * The owner opened this screen and found four hundred and seventy-eight identical cards.
 * The log was answering *"what went out today"*, which nobody asks, instead of *"what
 * have we said to this person, and did they answer"*, which is the only question a gym
 * has about its messages.
 *
 * So: people down the left, their thread in the middle, and who they are down the right.
 * **The right column is about fees, not about chat** — reception reads a thread in order
 * to do something, and what there is to do is almost always take money or ring them.
 *
 * At 360px the three become one. The list is the page; choosing somebody replaces it with
 * their thread, with their details folded into a strip at the top. No pane is hidden
 * behind a toggle, because a reception desk has one hand free.
 *
 * The flat log survives under "All messages", which is what you want when a send went
 * wrong rather than when you want to know what a member was told.
 */

export const dynamic = 'force-dynamic';

export default async function CrmMessagesPage({ searchParams }: { searchParams: Promise<{ only?: string; member?: string; view?: string }> }) {
  const { actor, gym, today, reader: crmReader } = await requireCrmContext();
  const t = await getTranslations('crm');
  const { clock, prisma, storage } = getContainer();
  const { only, member, view: viewMode } = await searchParams;
  const failedOnly = only === 'failed';
  const showLog = viewMode === 'log' || failedOnly;

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
  const [conversations, counts] = await Promise.all([
    reader.conversations(gym.id),
    reader.countsToday(gym.id, new Date(`${todayIST(clock)}T00:00:00+05:30`)),
  ]);

  const sentToday = (counts['SENT'] ?? 0) + (counts['DELIVERED'] ?? 0) + (counts['READ'] ?? 0) + (counts['SIMULATED'] ?? 0);
  const notSentToday = (counts['SKIPPED'] ?? 0) + (counts['FAILED'] ?? 0);
  const waiting = conversations.filter((row) => row.hasInbound).length;

  // Signing is a local HMAC, so a column of faces costs nothing (CLAUDE.md §2.8).
  const rows: InboxRow[] = await Promise.all(
    conversations.map(async (row) => ({
      memberId: row.memberId,
      memberName: row.memberName,
      lastAt: row.lastAt.toISOString(),
      lastPreview: row.lastPreview,
      lastDirection: row.lastDirection,
      messages: row.messages,
      hasInbound: row.hasInbound,
      photoUrl: row.photoKey === null ? null : await storage.signedUrl(row.photoKey, 300),
    })),
  );

  const chosen = member === undefined ? null : (conversations.find((row) => row.memberId === member) ?? null);

  const thread: ThreadMessage[] =
    member === undefined
      ? []
      : (await reader.list(gym.id, { memberId: member, limit: 200 }))
          // Oldest first: a conversation reads downwards.
          .reverse()
          .map((row) => ({
            id: row.id,
            direction: row.direction,
            purpose: row.purpose,
            status: row.status,
            ruleCode: row.ruleCode,
            bodyPreview: row.bodyPreview,
            errorCode: row.errorCode,
            at: row.createdAt.toISOString(),
          }));

  const window = serviceWindow(chosen?.lastInboundAt ?? null, clock.now());
  const profile = member === undefined ? null : await crmReader.member(gym.id, member, today);
  const profilePhoto = profile?.photoKey == null ? null : await storage.signedUrl(profile.photoKey, 300);
  const mayReply = can(actor, 'member.edit', clock.now());

  // ── The flat log, kept for when a send went wrong ────────────────────────────
  if (showLog) {
    const shown = failedOnly
      ? [...(await reader.list(gym.id, { status: 'SKIPPED', limit: 100 })), ...(await reader.list(gym.id, { status: 'FAILED', limit: 100 }))].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        )
      : await reader.list(gym.id, { limit: 100 });

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

    return (
      <>
        <AutoRefresh seconds={60} />
        <CrmHeader title={t('messages.title')} subtitle={t('messages.helper')} back="/crm/messages" />
        <div className="grid gap-4 p-4 lg:p-0">
          <p className="text-small text-brand-stone">{t('messages.today', { sent: sentToday, skipped: notSentToday })}</p>
          <Chips active={failedOnly ? 'failed' : 'log'} t={t} />
        </div>
        <MessageList rows={view} />
        <BottomNav active="more" />
      </>
    );
  }

  // ── The inbox ────────────────────────────────────────────────────────────────
  return (
    <>
      <AutoRefresh seconds={60} />
      <CrmHeader
        title={chosen === null ? t('messages.title') : (chosen.memberName ?? t('messages.unknownMember'))}
        {...(chosen === null ? { subtitle: t('messages.helper') } : {})}
        back={chosen === null ? '/crm/more' : '/crm/messages'}
      />

      {chosen === null ? (
        <div className="grid gap-3 p-4 lg:px-0">
          <p className="text-small text-brand-stone">
            {t('messages.today', { sent: sentToday, skipped: notSentToday })}
            {waiting === 0 ? '' : ` — ${t('messages.waitingReply', { count: waiting })}`}
          </p>
          <Chips active="people" t={t} />
        </div>
      ) : null}

      {/* One column on a phone, three on a desk. The chosen thread replaces the list on
          a phone rather than sitting under it. */}
      <div className="lg:grid lg:h-[calc(100dvh-13rem)] lg:grid-cols-[20rem_minmax(0,1fr)_18rem] lg:gap-4">
        <section className={cn(CRM_CARD, 'min-h-0 overflow-hidden', chosen === null ? 'mx-4 lg:mx-0' : 'hidden lg:block')}>
          <InboxList rows={rows} selected={member ?? null} />
        </section>

        <section className={cn(CRM_CARD, 'min-h-0 overflow-hidden', chosen === null ? 'hidden lg:block' : 'mx-4 flex h-[calc(100dvh-14rem)] flex-col lg:mx-0 lg:h-auto')}>
          {chosen === null ? (
            <p className="grid h-full place-items-center p-8 text-center text-crm-body text-brand-stone">{t('messages.pickPerson')}</p>
          ) : (
            <>
              {/* On a phone the member's details are a strip here; on a desk they are the
                  third column and this is left out. */}
              {profile === null ? null : (
                <div className="flex items-center gap-3 border-b border-brand-stone/12 px-4 py-3 lg:hidden">
                  <Face url={profilePhoto} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-crm-body font-semibold text-brand-obsidian">{profile.fullName}</p>
                    <p className="tabular text-small text-brand-stone">{displayPhone(profile.mobile)}</p>
                  </div>
                  <Link href={`/crm/members/${profile.id}`} className="shrink-0 text-small font-semibold text-brand-link">
                    {t('messages.openMember')}
                  </Link>
                </div>
              )}
              <InboxThread memberId={chosen.memberId} messages={thread} windowMinutesLeft={mayReply && window.open ? window.minutesLeft : null} />
            </>
          )}
        </section>

        {/* Who they are, and what there is to do about it. Reception reads a thread in
            order to act, and the action is nearly always money or a phone call. */}
        <aside className={cn(CRM_CARD, 'hidden min-h-0 overflow-y-auto lg:block', profile === null ? 'lg:hidden' : '')}>
          {profile === null ? null : (
            <div className="grid gap-4 p-4">
              <div className="grid justify-items-center gap-2 text-center">
                <Face url={profilePhoto} big />
                <p className="text-crm-body font-semibold text-brand-obsidian">{profile.fullName}</p>
                <p className="tabular text-small text-brand-stone">{displayPhone(profile.mobile)}</p>
                {profile.memberCode === null ? null : <p className="text-small text-brand-stone">{profile.memberCode}</p>}
              </div>

              <dl className="grid gap-2 border-t border-brand-stone/12 pt-4 text-small">
                <Fact label={t('profile.plan')} value={profile.planMonths === null ? t('profile.notGiven') : t('members.months', { count: profile.planMonths })} />
                <Fact
                  label={t('profile.paidTill')}
                  value={profile.effectiveEndDate === null ? t('profile.notGiven') : formatISTDate(profile.effectiveEndDate, actor.language)}
                  tone={FEE_TONE[profile.feeState].text}
                />
                <Fact label={t('profile.whatsappOptIn')} value={profile.whatsappOptIn ? t('profile.yes') : t('profile.no')} />
              </dl>

              <div className="grid gap-2 border-t border-brand-stone/12 pt-4">
                <a
                  href={`tel:${profile.mobile}`}
                  className="flex min-h-12 items-center justify-center gap-2 rounded-button bg-brand-obsidian text-crm-body font-semibold text-brand-white"
                >
                  <CrmIcon name="calls" className="size-5" />
                  {t('profile.call')}
                </a>
                <Link
                  href={`/crm/members/${profile.id}/renew`}
                  className="flex min-h-12 items-center justify-center gap-2 rounded-button bg-brand-accent text-crm-body font-semibold text-brand-white"
                >
                  <CrmIcon name="fees" className="size-5" />
                  {t('profile.takeFees')}
                </Link>
                <Link
                  href={`/crm/members/${profile.id}`}
                  className="flex min-h-12 items-center justify-center rounded-button border-2 border-brand-obsidian text-crm-body font-semibold text-brand-obsidian"
                >
                  {t('messages.openMember')}
                </Link>
              </div>
            </div>
          )}
        </aside>
      </div>

      <BottomNav active="more" />
    </>
  );
}

function Face({ url, big = false }: { url: string | null; big?: boolean }) {
  const size = big ? 'size-20' : 'size-11';
  if (url === null) {
    return (
      <span className={cn('grid shrink-0 place-items-center rounded-full bg-brand-stone/15 text-brand-stone', size)}>
        <CrmIcon name="members" className={big ? 'size-10' : 'size-6'} />
      </span>
    );
  }
  const px = big ? 80 : 44;
  return <img src={url} alt="" width={px} height={px} className={cn('shrink-0 rounded-full object-cover', size)} />;
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-brand-stone">{label}</dt>
      <dd className={cn('text-end font-semibold', tone ?? 'text-brand-obsidian')}>{value}</dd>
    </div>
  );
}

function Chips({ active, t }: { active: 'people' | 'log' | 'failed'; t: Awaited<ReturnType<typeof getTranslations<'crm'>>> }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link href="/crm/messages" className={pillClass(active === 'people')}>
        {t('messages.filterPeople')}
      </Link>
      <Link href="/crm/messages?view=log" className={pillClass(active === 'log')}>
        {t('messages.filterAll')}
      </Link>
      <Link href="/crm/messages?only=failed" className={pillClass(active === 'failed')}>
        {t('messages.filterFailed')}
      </Link>
      <Link
        href="/crm/messages/simulator"
        className="ms-auto inline-flex min-h-11 items-center rounded-full border border-brand-stone/25 px-4 text-small font-semibold text-brand-obsidian hover:border-brand-accent hover:text-brand-accent"
      >
        {t('simulator.open')}
      </Link>
    </div>
  );
}
