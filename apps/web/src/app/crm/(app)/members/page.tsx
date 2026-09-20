import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { FeeState, MemberStatus } from '@mfp/shared';
import { BottomNav, CrmHeader, FEE_TONE, MemberRow, CRM_CARD, pillClass } from '@/components/crm/crm-chrome';
import { CrmIcon } from '@/components/crm/crm-icons';
import { cn } from '@/lib/cn';
import { MemberSearch } from '@/components/crm/member-search';
import { requireCrmContext } from '@/lib/crm';

/**
 * Members — list, search and fee filters (crm-ux-blueprint §4).
 *
 * The search box submits to the same page as a query string, so a result list can be
 * shared, bookmarked or reloaded, and the back button behaves.
 */

export const dynamic = 'force-dynamic';

const FEE_FILTERS: readonly FeeState[] = ['EXPIRED', 'DUE_SOON', 'PAID'];

export default async function CrmMembersPage({ searchParams }: { searchParams: Promise<{ q?: string; fee?: string; status?: string }> }) {
  const { gym, today, reader } = await requireCrmContext();
  const t = await getTranslations('crm');
  const { q, fee, status } = await searchParams;

  const feeState = FEE_FILTERS.includes(fee as FeeState) ? (fee as FeeState) : undefined;
  const members = await reader.members(gym.id, today, {
    ...(q === undefined ? {} : { search: q }),
    ...(feeState === undefined ? {} : { feeState }),
    ...(status === 'ACTIVE' ? { status: 'ACTIVE' as MemberStatus } : {}),
    limit: 100,
  });

  const chip = (active: boolean, tone?: string) => pillClass(active, tone);

  return (
    <>
      <CrmHeader title={t('members.title')} subtitle={t('menu.members.desc')} />
      <div className={cn(CRM_CARD, 'px-4 pt-3 pb-3')}>
        <MemberSearch placeholder={t('members.search')} initial={q ?? ''} />
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/crm/members" className={chip(feeState === undefined)}>
            {t('members.filterAll')}
          </Link>
          {FEE_FILTERS.map((state) => (
            <Link key={state} href={`/crm/members?fee=${state}`} className={chip(feeState === state, FEE_TONE[state].chip)}>
              {t(`feeState.${state}`)}
            </Link>
          ))}
        </div>
      </div>

      <p className="px-4 py-2 text-small text-brand-stone">{t('members.count', { count: members.length })}</p>
      {members.length === 0 ? (
        <p className="px-4 py-8 text-center text-crm-body text-brand-stone">{t('members.empty')}</p>
      ) : (
        <ul className={cn(CRM_CARD, 'overflow-hidden')}>
          {members.map((member) => (
            <li key={member.id}>
              <MemberRow member={member} />
            </li>
          ))}
        </ul>
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
