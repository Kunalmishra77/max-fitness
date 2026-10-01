import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { formatISTDate, type ISTDate } from '@mfp/shared';
import type { MemberListItem } from '@mfp/db';
import { FEE_TONE, initials } from '@/components/crm/crm-chrome';
import { CrmIcon } from '@/components/crm/crm-icons';
import { cn } from '@/lib/cn';
import { displayPhone } from '@/lib/site';

/**
 * The members list (crm-ux-blueprint §4; ADR-086).
 *
 * The owner asked to see, without opening anybody: the photo, the number, when they
 * joined, their plan, their status, how long the fees are paid for, which half of the day
 * they come, and when they were last in. That is eight things, so the shape changes with
 * the screen rather than shrinking: a card per member on a phone, where the fee state and
 * the name come first and the rest reads as one line underneath, and a real table from
 * `lg`, where the same values line up in columns the eye can scan down.
 *
 * Both are the same link to the same profile, and both say the fee state in words as well
 * as colour (crm-ux-blueprint §1).
 */

export interface MemberListEntry {
  readonly member: MemberListItem;
  /** Short-lived signed URL for the member's photo, or `null` for initials. */
  readonly photoUrl: string | null;
}

const COLUMNS = ['member', 'mobile', 'plan', 'status', 'paidTill', 'slot', 'joined', 'lastSeen'] as const;

/** `lg` grid: avatar, name, number, plan, status, paid-till, slot, joined, last seen, chevron. */
const GRID =
  'lg:grid lg:grid-cols-[2.75rem_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,.8fr)_minmax(0,.9fr)_minmax(0,1fr)_minmax(0,.8fr)_minmax(0,.9fr)_minmax(0,.9fr)_1.25rem] lg:items-center lg:gap-4';

export async function MemberList({ entries, today }: { entries: readonly MemberListEntry[]; today: ISTDate }) {
  const t = await getTranslations('crm');

  return (
    <div className="overflow-hidden rounded-panel border border-brand-stone/15 bg-white shadow-sm">
      <div aria-hidden className={cn('hidden border-b border-brand-stone/15 bg-brand-paper px-4 py-2 text-small font-semibold text-brand-stone', GRID)}>
        <span />
        {COLUMNS.map((column) => (
          <span key={column} className="truncate">
            {t(`members.col.${column}` as never)}
          </span>
        ))}
        <span />
      </div>
      <ul>
        {entries.map((entry) => (
          <li key={entry.member.id}>
            <MemberListRow entry={entry} today={today} />
          </li>
        ))}
      </ul>
    </div>
  );
}

async function MemberListRow({ entry, today }: { entry: MemberListEntry; today: ISTDate }) {
  const t = await getTranslations('crm');
  const locale = await getLocale();
  const { member, photoUrl } = entry;
  const left = member.status === 'LEFT';
  const tone = left ? FEE_TONE.NONE : FEE_TONE[member.feeState];
  const days = member.daysLeft;

  const feeLine = left
    ? t('members.left')
    : member.feeState === 'NONE' || days === null
      ? t(`feeState.${member.feeState}`)
      : days > 0
        ? t('feeState.daysLeft', { count: days })
        : days === 0
          ? t('feeState.dueToday')
          : t('feeState.overdue', { count: Math.abs(days) });

  const dash = '—';
  const plan =
    member.planMonths === null ? dash : member.planMonths === 1 ? t('profile.monthly') : t('profile.months', { count: member.planMonths });
  const paidTill = member.effectiveEndDate === null ? dash : formatISTDate(member.effectiveEndDate, locale);
  const joined = member.joinedOn === null ? dash : formatISTDate(member.joinedOn, locale);
  const slot = member.trainingSlot === null ? dash : t(`members.slotShort.${member.trainingSlot}` as never);
  // Whole days, counted from midnight IST, so "today" means today and not "19 hours".
  const lastSeen =
    member.lastAttendanceAt === null
      ? t('members.neverSeen')
      : (() => {
          const ago = Math.floor((new Date(`${today}T00:00:00+05:30`).getTime() - member.lastAttendanceAt.getTime()) / 86_400_000);
          return ago <= 0 ? t('members.seenToday') : t('members.seenDaysAgo', { count: ago });
        })();

  const avatar =
    photoUrl === null ? (
      <span aria-hidden className={cn('flex size-11 shrink-0 items-center justify-center rounded-full font-display text-body font-bold text-brand-white', tone.band)}>
        {initials(member.fullName)}
      </span>
    ) : (
      // A signed, short-lived URL to a private file: next/image would cache it.
      <img src={photoUrl} alt="" width={44} height={44} className={cn('size-11 shrink-0 rounded-full object-cover ring-2', left ? 'ring-brand-stone/30' : 'ring-brand-accent/30')} />
    );

  const cell = 'truncate text-small text-brand-ink';

  return (
    <Link
      href={`/crm/members/${member.id}`}
      className={cn('group flex min-h-16 items-start gap-3 border-b border-brand-stone/15 px-4 py-3 transition-colors hover:bg-brand-paper', GRID)}
    >
      {avatar}

      {/* Phone: name, then everything else as one readable block. */}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 lg:gap-0">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-crm-body font-semibold text-brand-ink">{member.fullName}</span>
          <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-small font-semibold lg:hidden', tone.chip)}>{feeLine}</span>
        </span>
        <span className="truncate text-small text-brand-stone">
          {member.memberCode ?? dash}
          <span className="lg:hidden"> · {displayPhone(member.mobile)}</span>
        </span>
        <span className="truncate text-small text-brand-stone lg:hidden">
          {plan} · {t('members.tillShort', { date: paidTill })} · {slot} · {lastSeen}
        </span>
      </span>

      <span className={cn(cell, 'hidden lg:block')}>{displayPhone(member.mobile)}</span>
      <span className={cn(cell, 'hidden lg:block')}>{plan}</span>
      <span className="hidden lg:block">
        <span className={cn('inline-block max-w-full truncate rounded-full px-2.5 py-0.5 text-small font-semibold', tone.chip)}>
          {left ? t('members.left') : t(`status.${member.status}` as never)}
        </span>
      </span>
      <span className={cn(cell, 'hidden lg:block')}>
        <span className="block truncate">{paidTill}</span>
        <span className={cn('block truncate text-small', tone.text)}>{feeLine}</span>
      </span>
      <span className={cn(cell, 'hidden lg:block')}>{slot}</span>
      <span className={cn(cell, 'hidden lg:block')}>{joined}</span>
      <span className={cn(cell, 'hidden lg:block')}>{lastSeen}</span>
      <CrmIcon name="chevron" className="hidden size-5 shrink-0 text-brand-stone transition-transform group-hover:translate-x-0.5 lg:block" />
    </Link>
  );
}
