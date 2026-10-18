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
    <header className="sticky top-0 z-10 bg-brand-obsidian text-brand-white lg:static lg:mb-6 lg:rounded-panel">
      <div className="flex min-h-16 items-center gap-3 px-4 py-2 lg:min-h-20 lg:px-6">
        {back === undefined ? null : (
          <Link
            href={back}
            aria-label={t('back')}
            className="-ml-2 flex size-12 shrink-0 items-center justify-center rounded-full text-brand-paper hover:bg-brand-white/10"
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
      {/* The brand's red rule. It used to fade to transparent across the width, which
          encodes nothing — a gradient for its own sake. Solid, and it reads as the stripe
          from the logo rather than as decoration. It rounds itself because clipping it to
          the panel with `overflow-hidden` also clipped the actions menu. */}
      <span aria-hidden className="block h-[3px] bg-brand-accent lg:rounded-b-panel" />
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
  /** A short-lived signed link. Initials stand in when there is no photograph. */
  readonly photoUrl?: string | null;
}

/**
 * One member, the same everywhere (crm-ux-blueprint §4, ADR-131).
 *
 * **The fee state is a band down the left edge, not a chip on the right.** U2 says a
 * colour means one thing; the owner's question down a list is *"who owes me"*, and a
 * chip at the far end of each row makes that a left-to-right read per member instead of
 * one glance down a column. `FEE_TONE.band` was defined for this and had never been used
 * by the row it was written for.
 *
 * The words stay beside it, because colour is never the only signal.
 */
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

  const tone = left ? FEE_TONE.NONE : FEE_TONE[member.feeState];

  return (
    <Link
      href={`/crm/members/${member.id}`}
      className="group relative flex min-h-16 items-center gap-3 border-b border-brand-stone/10 bg-white py-2 ps-5 pe-4 transition-colors hover:bg-brand-paper"
    >
      {/* The one glance down the list: who owes money. */}
      <span aria-hidden className={cn('absolute inset-y-0 start-0 w-1', tone.band)} />

      {/* U1, faces before names — the owner knows his members by face. The row has
          always said initials, which is the fallback and was standing in for the rule. */}
      {member.photoUrl == null ? (
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-stone/15 font-display text-body font-bold text-brand-stone"
        >
          {initials(member.fullName)}
        </span>
      ) : (
        // A link that lapses in five minutes; nothing for the image optimiser to cache.
        <img src={member.photoUrl} alt="" width={44} height={44} className="size-11 shrink-0 rounded-full object-cover" />
      )}

      <span className="flex min-w-0 flex-1 flex-col justify-center">
        <span className="truncate text-crm-body font-semibold text-brand-ink">{member.fullName}</span>
        <span className="truncate text-small text-brand-stone">{member.memberCode ?? '—'}</span>
      </span>
      <span className={cn('shrink-0 text-small font-semibold', tone.text)}>{line}</span>
      <CrmIcon name="chevron" className="size-5 shrink-0 text-brand-stone/60 transition-transform group-hover:translate-x-0.5" />
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

/**
 * A white panel: edge to edge on a phone, a card with a border on a computer (ADR-062).
 * Lists and forms share it so no two screens invent their own surface.
 */
/**
 * A column a form can be read and filled in (ADR-130).
 *
 * The shell is wide, because a register, a message thread and a day's attendance all
 * gain from the room. A form does not: a text field two feet across is harder to fill
 * in than one the width of a page, and the label ends up an arm's length from the box.
 *
 * So pages that are mostly fields wrap their content in this, and pages that are mostly
 * rows do not. One container cannot serve both, and the difference is the page's to
 * know.
 */
export const CRM_FORM_COLUMN = 'mx-auto w-full max-w-3xl';

/**
 * A white panel: edge to edge on a phone, a card with a border on a computer (ADR-062,
 * ADR-131).
 *
 * **It has no shadow.** It used to, and so did every tile, every report card and every
 * list — the register, a settings form, the birthday list and the month's money all
 * wearing one border radius and one soft grey shadow. Nothing was more important than
 * anything else, which is what "basic" looks like when you cannot point at a single
 * thing that is wrong with it.
 *
 * Depth now has to be earned: `CRM_CARD_RAISED` is the one thing on a screen that
 * matters most, and there is at most one of it.
 */
export const CRM_CARD = 'bg-white lg:rounded-panel lg:border lg:border-brand-stone/12';

/** The single most important panel on a screen. At most one per screen. */
export const CRM_CARD_RAISED = 'bg-white rounded-panel border border-brand-stone/12 shadow-[0_2px_16px_-6px_rgb(10_10_11/0.18)]';

/**
 * A number the owner reads at a glance, and the one word that says what it is (ADR-131).
 *
 * **The number is the tile.** U3 asks for numbers over sentences, and the home screen
 * was setting the label at body size beside a number barely larger — four tinted blocks
 * of equal weight, each asking for attention. Now the surface is quiet, the number is
 * large and tabular, and the colour is on the number alone, so four of these read as one
 * row of figures rather than four posters.
 *
 * No hover lift. Every card lifting half a pixel is the thing that makes an interface
 * feel generated; the surface changes instead, which is what a pointer actually needs
 * to know.
 */
export function StatTile({
  label,
  value,
  note,
  href,
  icon,
  tone = 'text-brand-obsidian',
}: {
  label: string;
  value: string | number;
  note?: string | undefined;
  href: string;
  icon: CrmIconName;
  /** A text colour from `FEE_TONE`, or the default ink. */
  tone?: string;
}) {
  return (
    <Link
      href={href}
      className="flex h-full min-h-28 flex-col justify-between gap-3 rounded-panel border border-brand-stone/12 bg-white p-4 transition-colors hover:border-brand-stone/30 hover:bg-brand-paper lg:min-h-36 lg:p-5"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-small font-semibold text-brand-stone">{label}</span>
        <CrmIcon name={icon} className="size-5 shrink-0 text-brand-stone/50" />
      </span>
      <span>
        <span className={cn('block font-display text-[2.5rem] leading-none font-bold tabular tracking-tight lg:text-[3rem]', tone)}>{value}</span>
        {note === undefined ? null : <span className="mt-1.5 block text-small text-brand-stone">{note}</span>}
      </span>
    </Link>
  );
}

/** A filter or tab pill; the chosen one is obsidian, or its own fee tint. */
export function pillClass(active: boolean, tone = 'bg-white text-brand-stone hover:text-brand-obsidian'): string {
  return cn(
    // `gap` rather than a space in the markup: a flex container eats whitespace between
    // its children, which turned "All 14" into "All14".
    'inline-flex min-h-11 items-center gap-1.5 rounded-full px-5 text-crm-body font-semibold transition-colors',
    active ? 'bg-brand-obsidian text-white' : tone,
  );
}
