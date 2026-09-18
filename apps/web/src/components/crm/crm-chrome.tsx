import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import type { FeeState } from '@mfp/shared';
import { formatINR } from '@mfp/shared';
import { cn } from '@/lib/cn';
import { CrmIcon, type CrmIconName } from './crm-icons';

/**
 * The CRM's shared furniture (crm-ux-blueprint §1, §2, §4).
 *
 * Colour is never the only signal: every fee state carries its words as well as its
 * colour, because the owner reads the row, not the palette. Targets are 56px or more.
 *
 * ADR-062: the bars are obsidian with the logo, icons are one SVG set instead of emoji,
 * and from `lg` the sidebar replaces the bottom bar.
 */

export const FEE_TONE: Record<FeeState, { band: string; chip: string; text: string }> = {
  PAID: { band: 'bg-semantic-fee-paid', chip: 'bg-tint-fee-paid-bg text-semantic-fee-paid', text: 'text-semantic-fee-paid' },
  DUE_SOON: { band: 'bg-semantic-fee-due-soon', chip: 'bg-tint-fee-due-soon-bg text-semantic-fee-due-soon', text: 'text-semantic-fee-due-soon' },
  EXPIRED: { band: 'bg-semantic-fee-expired', chip: 'bg-tint-fee-expired-bg text-semantic-fee-expired', text: 'text-semantic-fee-expired' },
  NONE: { band: 'bg-semantic-fee-none', chip: 'bg-tint-fee-none-bg text-semantic-fee-none', text: 'text-semantic-fee-none' },
};

export const rupees = (paise: number) => formatINR(paise, { showPaise: false });

export async function CrmHeader({
  title,
  right,
  back,
  subtitle,
  brand = false,
}: {
  title: string;
  right?: ReactNode;
  back?: string;
  /** One line under the title saying what this screen is for. */
  subtitle?: string;
  /** Show the logo at the start (the home screen). */
  brand?: boolean;
}) {
  const t = await getTranslations('crm.shell');
  return (
    <header className="sticky top-0 z-10 bg-brand-obsidian text-brand-white lg:static lg:mb-6 lg:overflow-hidden lg:rounded-panel">
      <div className="flex min-h-16 items-center gap-3 px-4 py-2 lg:min-h-20 lg:px-6">
        {back === undefined ? null : (
          <Link
            href={back}
            aria-label={t('back')}
            className="-ml-2 flex size-12 items-center justify-center rounded-full text-brand-paper hover:bg-brand-white/10 lg:hidden"
          >
            <CrmIcon name="back" className="size-6" />
          </Link>
        )}
        {brand ? <img src="/brand/logo-96.webp" alt="" width={99} height={96} className="h-10 w-auto lg:hidden" /> : null}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-title leading-tight font-bold tracking-[0.02em] lg:text-display-m">{title}</h1>
          {subtitle === undefined ? null : <p className="truncate text-small text-brand-mist">{subtitle}</p>}
        </div>
        {right}
      </div>
      <span aria-hidden className="block h-0.5 bg-gradient-to-r from-brand-accent via-brand-accent/40 to-transparent" />
    </header>
  );
}

const TABS: ReadonlyArray<{ href: string; key: 'home' | 'members' | 'fees' | 'attendance' | 'more'; icon: CrmIconName }> = [
  { href: '/crm', key: 'home', icon: 'home' },
  { href: '/crm/members', key: 'members', icon: 'members' },
  { href: '/crm/members?fee=EXPIRED', key: 'fees', icon: 'fees' },
  { href: '/crm/attendance', key: 'attendance', icon: 'attendance' },
  { href: '/crm/more', key: 'more', icon: 'more' },
];

export async function BottomNav({ active }: { active: 'home' | 'members' | 'fees' | 'attendance' | 'more' }) {
  const t = await getTranslations('crm.nav');
  return (
    <nav aria-label={t('label')} className="fixed inset-x-0 bottom-0 z-20 bg-brand-obsidian pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="mx-auto flex max-w-xl">
        {TABS.map((tab) => (
          <li key={tab.key} className="flex-1">
            <Link
              href={tab.href}
              aria-current={active === tab.key ? 'page' : undefined}
              className={cn(
                'relative flex min-h-16 flex-col items-center justify-center gap-1 text-[0.8rem] font-semibold transition-colors',
                active === tab.key ? 'text-brand-white' : 'text-brand-mist hover:text-brand-white',
              )}
            >
              {active === tab.key ? <span aria-hidden className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-brand-accent-glow" /> : null}
              <CrmIcon name={tab.icon} className={cn('size-6', active === tab.key && 'text-brand-accent-glow')} />
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
    <Link
      href={`/crm/members/${member.id}`}
      className="group flex min-h-16 items-center gap-3 border-b border-brand-stone/15 bg-white px-4 transition-colors hover:bg-brand-paper"
    >
      <span
        aria-hidden
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-full font-display text-body font-bold text-brand-white',
          left ? FEE_TONE.NONE.band : FEE_TONE[member.feeState].band,
        )}
      >
        {initials(member.fullName)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center py-3">
        <span className="truncate text-crm-body font-semibold text-brand-ink">{member.fullName}</span>
        <span className="truncate text-small text-brand-stone">{member.memberCode ?? '—'}</span>
      </span>
      <span className={cn('shrink-0 rounded-full px-3 py-1 text-small font-semibold', left ? FEE_TONE.NONE.chip : FEE_TONE[member.feeState].chip)}>
        {line}
      </span>
      <CrmIcon name="chevron" className="size-5 shrink-0 text-brand-stone transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/** Up to two initials, for the round badge in a member row. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts.at(-1)?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase();
}
