import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { can, mayAfterPinEntry } from '@mfp/core';
import { formatISTDate } from '@mfp/shared';
import { eraseMemberAction, unlockMemberDataAction, voidPaymentAction } from '@/app/crm/actions';
import { BottomNav, CrmHeader, FEE_TONE, rupees } from '@/components/crm/crm-chrome';
import { MemberDataSection } from '@/components/crm/member-data';
import { VoidPaymentButton } from '@/components/crm/void-payment';
import { getContainer } from '@/lib/container';
import { requireCrmContext } from '@/lib/crm';

/**
 * Member profile (crm-ux-blueprint §5).
 *
 * The fee card answers the only question that matters at the desk — paid until when —
 * in words and colour. Then the three things staff actually do: call, WhatsApp, take
 * fees. History is below that, not above it.
 */

export const dynamic = 'force-dynamic';

export default async function CrmMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor, gym, today, reader } = await requireCrmContext();
  const t = await getTranslations('crm');
  const locale = actor.language;
  const { id } = await params;

  const member = await reader.member(gym.id, id, today);
  if (member === null) notFound();

  const { clock, storage } = getContainer();
  // Photos are private objects, shown through a link that lapses in five minutes
  // (CLAUDE.md §2.8) — long enough to look at the page, too short to share.
  const photoUrl = member.photoKey === null ? null : await storage.signedUrl(member.photoKey, 300);
  const mayTakeFees = can(actor, 'payment.record', clock.now());
  // The button shows for a role that may void; the PIN it then asks for is what actually
  // permits it (security-plan.md §3.1).
  const mayVoid = mayAfterPinEntry(actor, 'payment.void', clock.now());
  // Owner only, and hidden rather than disabled for everyone else (crm-ux-blueprint §16).
  const mayManageData = mayAfterPinEntry(actor, 'member.erase', clock.now());
  const exportReady = can(actor, 'member.export', clock.now());
  const daysInMonth = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0).getDate();
  const attended = new Set(member.attendanceDays);
  const feeLine =
    member.daysLeft === null
      ? t('feeState.NONE')
      : member.daysLeft > 0
        ? t('feeState.daysLeft', { count: member.daysLeft })
        : member.daysLeft === 0
          ? t('feeState.dueToday')
          : t('feeState.overdue', { count: Math.abs(member.daysLeft) });

  return (
    <>
      <CrmHeader title={member.fullName} back="/crm/members" />

      <div className="bg-white px-4 pt-4 pb-5 text-center">
        {photoUrl === null ? null : (
          // A signed, short-lived URL to a private file: next/image would cache it.
          <img src={photoUrl} alt={t('profile.photoAlt', { name: member.fullName })} width={96} height={96} className="mx-auto mb-3 size-24 rounded-full object-cover" />
        )}
        <p className="font-display text-display-m font-bold text-brand-plate-navy">{member.fullName}</p>
        <p className="text-crm-body text-brand-rubber-grey">{member.memberCode ?? '—'}</p>

        <div className={`mt-4 rounded-panel p-4 text-left ${FEE_TONE[member.feeState].chip}`}>
          <p className="text-crm-body font-bold">
            {t(`feeState.${member.feeState}`)}
            {member.effectiveEndDate === null ? '' : ` — ${t('feeState.till', { date: formatISTDate(member.effectiveEndDate, locale) })}`}
          </p>
          <p className="text-crm-body">{feeLine}</p>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <a href={`tel:${member.mobile}`} className="flex min-h-16 flex-col items-center justify-center rounded-panel bg-brand-plate-navy text-small font-semibold text-white">
            <span aria-hidden className="text-xl">
              📞
            </span>
            {t('profile.call')}
          </a>
          <a
            href={`https://wa.me/${member.mobile.replace(/\D/g, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-16 flex-col items-center justify-center rounded-panel border-2 border-brand-plate-navy text-small font-semibold text-brand-plate-navy"
          >
            <span aria-hidden className="text-xl">
              💬
            </span>
            {t('profile.whatsapp')}
          </a>
          {mayTakeFees ? (
            <Link
              href={`/crm/members/${member.id}/renew`}
              className="flex min-h-16 flex-col items-center justify-center rounded-panel bg-brand-signboard-red text-small font-semibold text-white"
            >
              <span aria-hidden className="text-xl">
                ₹
              </span>
              {t('profile.takeFees')}
            </Link>
          ) : null}
        </div>
      </div>

      <section className="mt-3 bg-white px-4 py-4">
        <h2 className="text-crm-body font-bold text-brand-plate-navy">{t('profile.attendanceMonth')}</h2>
        <div className="mt-3 grid grid-cols-7 gap-2" aria-hidden>
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => (
            <span
              key={day}
              className={`flex size-8 items-center justify-center rounded-full text-small ${
                attended.has(day) ? 'bg-semantic-fee-paid text-white' : 'bg-tint-fee-none-bg text-brand-rubber-grey'
              }`}
            >
              {day}
            </span>
          ))}
        </div>
        <p className="mt-3 text-crm-body">{t('profile.attendanceDays', { count: member.attendanceDays.length })}</p>
      </section>

      <section className="mt-3 bg-white px-4 py-4">
        <h2 className="text-crm-body font-bold text-brand-plate-navy">{t('profile.plansAndMoney')}</h2>
        {member.payments.length === 0 ? (
          <p className="mt-2 text-crm-body text-brand-rubber-grey">{t('profile.noPayments')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-brand-rubber-grey/15">
            {member.payments.map((payment) => (
              <li key={payment.id} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span>
                    <span className={`block text-crm-body font-semibold ${payment.status === 'VOIDED' ? 'text-brand-rubber-grey line-through' : ''}`}>
                      {rupees(payment.amountPaise)}
                    </span>
                    <span className="block text-small text-brand-rubber-grey">
                      {payment.receiptNo === null ? payment.status : t('profile.receipt', { receiptNo: payment.receiptNo })}
                      {payment.status === 'VOIDED' ? ` — ${t('void.voided')}` : ''}
                    </span>
                  </span>
                  <span className="text-small text-brand-rubber-grey">{payment.method}</span>
                </div>
                {mayVoid && payment.status === 'PAID' && payment.receiptNo !== null ? (
                  <VoidPaymentButton
                    paymentId={payment.id}
                    amount={rupees(payment.amountPaise)}
                    receiptNo={payment.receiptNo}
                    action={voidPaymentAction}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <ul className="mt-4 divide-y divide-brand-rubber-grey/15">
          {member.memberships.map((membership) => (
            <li key={membership.id} className="flex items-baseline justify-between gap-3 py-3 text-crm-body">
              <span>
                {membership.durationMonths === null
                  ? '—'
                  : membership.durationMonths === 1
                    ? t('profile.monthly')
                    : t('profile.months', { count: membership.durationMonths })}
              </span>
              <span className="text-small text-brand-rubber-grey">
                {membership.startDate === null ? '' : `${formatISTDate(membership.startDate, locale)} – `}
                {formatISTDate(membership.endDate, locale)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {mayManageData ? (
        <MemberDataSection
          memberId={member.id}
          memberName={member.fullName}
          exportReady={exportReady}
          unlock={unlockMemberDataAction}
          erase={eraseMemberAction}
        />
      ) : null}

      <BottomNav active="members" />
    </>
  );
}
