import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { FeeState, MemberStatus } from '@mfp/shared';
import { BottomNav, CrmHeader, FEE_TONE, MemberRow } from '@/components/crm/crm-chrome';
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

  const chip = (label: string, href: string, active: boolean, tone = 'bg-white') =>
    `inline-flex min-h-11 items-center rounded-button px-4 text-crm-body font-semibold ${active ? 'bg-brand-obsidian text-white' : tone}`;

  return (
    <>
      <CrmHeader title={t('members.title')} subtitle={t('menu.members.desc')} />
      <div className="bg-white px-4 pb-3">
        <MemberSearch placeholder={t('members.search')} initial={q ?? ''} />
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/crm/members" className={chip(t('members.filterAll'), '/crm/members', feeState === undefined)}>
            {t('members.filterAll')}
          </Link>
          {FEE_FILTERS.map((state) => (
            <Link key={state} href={`/crm/members?fee=${state}`} className={chip(t(`feeState.${state}`), '', feeState === state, FEE_TONE[state].chip)}>
              {t(`feeState.${state}`)}
            </Link>
          ))}
        </div>
      </div>

      <p className="px-4 py-2 text-small text-brand-stone">{t('members.count', { count: members.length })}</p>
      {members.length === 0 ? (
        <p className="px-4 py-8 text-center text-crm-body text-brand-stone">{t('members.empty')}</p>
      ) : (
        <ul>
          {members.map((member) => (
            <li key={member.id}>
              <MemberRow member={member} />
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/crm/members/new"
        className="fixed right-5 bottom-24 z-20 flex size-16 transition-transform hover:scale-105 lg:right-10 lg:bottom-10 items-center justify-center rounded-full bg-brand-accent text-3xl text-brand-white shadow-[var(--shadow-overlay)]"
        aria-label={t('home.addMember')}
      >
        ＋
      </Link>
      <BottomNav active={feeState === 'EXPIRED' ? 'fees' : 'members'} />
    </>
  );
}
