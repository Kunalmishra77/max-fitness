import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import type { FeeState } from '@mfp/shared';
import { formatINR } from '@mfp/shared';
import { cn } from '@/lib/cn';

/**
 * The CRM's shared furniture (crm-ux-blueprint §1, §2, §4).
 *
 * Colour is never the only signal: every fee state carries its words as well as its
 * colour, because the owner reads the row, not the palette. Targets are 56px or more.
 */

export const FEE_TONE: Record<FeeState, { band: string; chip: string; text: string }> = {
  PAID: { band: 'bg-semantic-fee-paid', chip: 'bg-tint-fee-paid-bg text-semantic-fee-paid', text: 'text-semantic-fee-paid' },
  DUE_SOON: { band: 'bg-semantic-fee-due-soon', chip: 'bg-tint-fee-due-soon-bg text-semantic-fee-due-soon', text: 'text-semantic-fee-due-soon' },
  EXPIRED: { band: 'bg-semantic-fee-expired', chip: 'bg-tint-fee-expired-bg text-semantic-fee-expired', text: 'text-semantic-fee-expired' },
  NONE: { band: 'bg-semantic-fee-none', chip: 'bg-tint-fee-none-bg text-semantic-fee-none', text: 'text-semantic-fee-none' },
};

export const rupees = (paise: number) => formatINR(paise, { showPaise: false });

export function CrmHeader({ title, right, back }: { title: string; right?: ReactNode; back?: string }) {
  return (
    <header className="sticky top-0 z-10 flex min-h-16 items-center gap-3 border-b border-brand-stone/20 bg-white px-4">
      {back === undefined ? null : (
        <Link href={back} aria-label="back" className="-ml-2 flex size-12 items-center justify-center rounded-full text-2xl text-brand-obsidian">
          ‹
        </Link>
      )}
      <h1 className="flex-1 truncate font-display text-title font-bold text-brand-obsidian">{title}</h1>
      {right}
    </header>
  );
}

const TABS = [
  { href: '/crm', key: 'home', icon: '🏠' },
  { href: '/crm/members', key: 'members', icon: '👥' },
  { href: '/crm/members?fee=EXPIRED', key: 'fees', icon: '₹' },
  { href: '/crm/attendance', key: 'attendance', icon: '✅' },
  { href: '/crm/more', key: 'more', icon: '•••' },
] as const;

export async function BottomNav({ active }: { active: 'home' | 'members' | 'fees' | 'attendance' | 'more' }) {
  const t = await getTranslations('crm.nav');
  return (
    <nav aria-label="Max Register" className="fixed inset-x-0 bottom-0 z-20 border-t border-brand-stone/20 bg-white pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-xl">
        {TABS.map((tab) => (
          <li key={tab.key} className="flex-1">
            <Link
              href={tab.href}
              aria-current={active === tab.key ? 'page' : undefined}
              className={cn(
                'flex min-h-16 flex-col items-center justify-center gap-0.5 text-small font-semibold',
                active === tab.key ? 'text-brand-accent' : 'text-brand-stone',
              )}
            >
              <span aria-hidden className="text-xl leading-none">
                {tab.icon}
              </span>
              {t(tab.key)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export interface MemberRowData {
  readonly id: string;
  readonly fullName: string;
  readonly memberCode: string | null;
  readonly feeState: FeeState;
  readonly daysLeft: number | null;
  readonly status: string;
}

/** One member, the same everywhere (crm-ux-blueprint §4). */
export async function MemberRow({ member }: { member: MemberRowData }) {
  const t = await getTranslations('crm');
  const left = member.status === 'LEFT';
  const days = member.daysLeft;
  const line =
    left || member.feeState === 'NONE'
      ? left
        ? t('members.left')
        : t('feeState.NONE')
      : days === null
        ? t(`feeState.${member.feeState}`)
        : days > 0
          ? t('feeState.daysLeft', { count: days })
          : days === 0
            ? t('feeState.dueToday')
            : t('feeState.overdue', { count: Math.abs(days) });

  return (
    <Link href={`/crm/members/${member.id}`} className="flex min-h-16 items-stretch gap-3 border-b border-brand-stone/15 bg-white">
      <span aria-hidden className={cn('w-1.5 shrink-0', left ? FEE_TONE.NONE.band : FEE_TONE[member.feeState].band)} />
      <span className="flex flex-1 flex-col justify-center py-3">
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate text-crm-body font-semibold text-brand-ink">{member.fullName}</span>
          <span className={cn('shrink-0 text-small font-semibold', left ? FEE_TONE.NONE.text : FEE_TONE[member.feeState].text)}>{line}</span>
        </span>
        <span className="text-small text-brand-stone">{member.memberCode ?? '—'}</span>
      </span>
      <span aria-hidden className="flex items-center pr-4 text-xl text-brand-stone">
        ›
      </span>
    </Link>
  );
}
