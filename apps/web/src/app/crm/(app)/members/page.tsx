import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { FeeState, MemberStatus } from '@mfp/shared';
import { BottomNav, CrmHeader, FEE_TONE, CRM_CARD, pillClass } from '@/components/crm/crm-chrome';
import { CrmIcon } from '@/components/crm/crm-icons';
import { cn } from '@/lib/cn';
import { MemberList } from '@/components/crm/member-list';
import { MemberSearch } from '@/components/crm/member-search';
import { can } from '@mfp/core';
import { getContainer } from '@/lib/container';
import { requireCrmContext, verificationDeps } from '@/lib/crm';

/**
 * Members — list, search and fee filters (crm-ux-blueprint §4).
 *
 * The search box submits to the same page as a query string, so a result list can be
 * shared, bookmarked or reloaded, and the back button behaves.
 */

export const dynamic = 'force-dynamic';

const FEE_FILTERS: readonly FeeState[] = ['EXPIRED', 'DUE_SOON', 'PAID'];

export default async function CrmMembersPage({ searchParams }: { searchParams: Promise<{ q?: string; fee?: string; status?: string; after?: string }> }) {
  const { actor, gym, today, reader } = await requireCrmContext();
  const t = await getTranslations('crm');
  const { q, fee, status, after } = await searchParams;

  const waiting = can(actor, 'verification.approve', getContainer().clock.now()) ? await verificationDeps().queue.count(gym.id) : 0;

  const feeState = FEE_FILTERS.includes(fee as FeeState) ? (fee as FeeState) : undefined;
  // The chips count the whole gym; a search narrows the list but not what is out there.
  const searching = (q ?? '').trim() !== '';
  const LIMIT = 100;
  const [page, counts] = await Promise.all([
    reader.membersPage(gym.id, today, {
      ...(q === undefined ? {} : { search: q }),
      ...(feeState === undefined ? {} : { feeState }),
      ...(status === 'ACTIVE' ? { status: 'ACTIVE' as MemberStatus } : {}),
      /**
       * Not people who have never paid (ADR-125) — unless the desk is searching, when
       * the only sane answer to a typed name is everybody of that name. Somebody
       * ringing about their sign-up must be findable from this box.
       */
      ...(searching ? {} : { awaitingPayment: false }),
      ...(after === undefined || after === '' ? {} : { cursor: after }),
      limit: LIMIT,
    }),
    // Numbers for the filter chips (ADR-097). They answer "is there anything to do?"
    // before reception has to tap anything to find out.
    reader.memberCounts(gym.id, today),
  ]);
  const members = page.rows;
  const totalForFilter = feeState === undefined ? counts.total : counts[feeState];

  /** Carries the filters onto the paging link, so "show more" stays inside the filter. */
  const moreHref = (cursor: string) => {
    const params = new URLSearchParams();
    if (q !== undefined && q !== '') params.set('q', q);
    if (feeState !== undefined) params.set('fee', feeState);
    if (status === 'ACTIVE') params.set('status', 'ACTIVE');
    params.set('after', cursor);
    return `/crm/members?${params.toString()}`;
  };

  // Signing is a local HMAC, not a request to Supabase, so a hundred thumbnails cost
  // nothing; each link lapses in five minutes like every other private file (CLAUDE.md §2.8).
  const { storage } = getContainer();
  const entries = await Promise.all(
    members.map(async (member) => ({
      member,
      photoUrl: member.photoKey === null ? null : await storage.signedUrl(member.photoKey, 300),
    })),
  );

  const chip = (active: boolean, tone?: string) => pillClass(active, tone);

  return (
    <>
      <CrmHeader title={t('members.title')} subtitle={t('menu.members.desc')} />
      <div className={cn(CRM_CARD, 'px-4 pt-3 pb-3')}>
        <MemberSearch placeholder={t('members.search')} initial={q ?? ''} />
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/crm/members" className={chip(feeState === undefined)}>
            {t('members.filterAll')} <span className="tabular opacity-70">{counts.total}</span>
          </Link>
          {FEE_FILTERS.map((state) => (
            <Link key={state} href={`/crm/members?fee=${state}`} className={chip(feeState === state, FEE_TONE[state].chip)}>
              {t(`feeState.${state}`)} <span className="tabular opacity-70">{counts[state]}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* QR arrivals are members too, so they are found here rather than behind a menu
          entry of their own (ADR-086). */}
      {waiting === 0 ? null : (
        <Link href="/crm/verify" className={cn(CRM_CARD, 'mt-3 flex min-h-16 items-center justify-between gap-3 px-4 py-3 hover:border-brand-accent')}>
          <span className="text-crm-body font-semibold text-brand-obsidian">{t('members.waiting', { count: waiting })}</span>
          <span className="rounded-full bg-brand-accent px-3 py-1 text-small font-bold text-brand-white">{t('members.check')}</span>
        </Link>
      )}

      {/* People who filled the form and never paid (ADR-125). Out of the register, but
          in front of the desk — the money is one phone call away and nobody is going to
          scroll a list looking for them. */}
      {counts.awaitingPayment === 0 ? null : (
        <Link
          href="/crm/members/waiting"
          className={cn(CRM_CARD, 'mt-3 flex min-h-16 items-center justify-between gap-3 px-4 py-3 hover:border-brand-accent')}
        >
          <span className="text-crm-body font-semibold text-brand-obsidian">
            {t('members.awaitingPayment', { count: counts.awaitingPayment })}
          </span>
          <span className="rounded-full bg-semantic-fee-due-soon px-3 py-1 text-small font-bold text-brand-white">{t('members.chase')}</span>
        </Link>
      )}

      {/* Say when the list is cut short rather than letting the number read as the whole gym. */}
      <p className="px-4 py-2 text-small text-brand-stone">
        {page.nextCursor === null ? t('members.count', { count: members.length }) : t('members.countOf', { shown: members.length, total: totalForFilter })}
      </p>
      {members.length === 0 ? (
        <p className="px-4 py-8 text-center text-crm-body text-brand-stone">{t('members.empty')}</p>
      ) : (
        <MemberList today={today} entries={entries} />
      )}

      {/**
       * U-3: a way to the rest of the register.
       *
       * The list said "showing 100 of 240" and stopped, so the other 140 were reachable
       * only by guessing a name into the search box — on the screen whose whole job is to
       * show you who the gym has.
       *
       * A link, not a button: the page stays server-rendered, the back button walks back
       * through the pages, and reception can send somebody a URL that still works.
       */}
      {page.nextCursor === null ? null : (
        <div className="px-4 py-5">
          <Link
            href={moreHref(page.nextCursor)}
            className="flex min-h-14 items-center justify-center rounded-button border-2 border-brand-obsidian px-6 text-crm-body font-bold text-brand-obsidian"
          >
            {t('members.showMore')}
          </Link>
        </div>
      )}

      <Link
        href="/crm/members/new"
        className="fixed right-5 bottom-24 z-20 flex size-16 items-center justify-center rounded-full bg-brand-accent text-brand-white shadow-[0_12px_30px_-8px_rgb(217_15_31/0.8)] transition-transform hover:scale-105 lg:right-10 lg:bottom-10"
        aria-label={t('home.addMember')}
      >
        <CrmIcon name="plus" className="size-8" />
      </Link>
      <BottomNav active={feeState === 'EXPIRED' ? 'fees' : 'members'} />
    </>
  );
}
