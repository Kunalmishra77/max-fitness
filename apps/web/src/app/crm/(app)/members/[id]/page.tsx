import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { can, mayAfterPinEntry } from '@mfp/core';
import { formatISTDate } from '@mfp/shared';
import { cancelAutopayAction, eraseMemberAction, startAutopayAction, unlockMemberDataAction, voidPaymentAction } from '@/app/crm/actions';
import { BottomNav, CrmHeader, FEE_TONE, rupees, initials } from '@/components/crm/crm-chrome';
import { CrmIcon } from '@/components/crm/crm-icons';
import { GovIdStrip } from '@/components/crm/gov-id-strip';
import { PhotoViewer } from '@/components/crm/photo-viewer';
import { displayPhone } from '@/lib/site';
import { cn } from '@/lib/cn';
import { DietPanel } from '@/components/crm/diet-panel';
import { MemberActionsMenu } from '@/components/crm/member-actions-menu';
import { VoidPaymentButton } from '@/components/crm/void-payment';
import { AutopayPanel } from '@/components/crm/autopay-panel';
import { getContainer } from '@/lib/container';
import { onlinePaymentsLive } from '@/lib/online-payments';
import { dietReader, requireCrmContext } from '@/lib/crm';

/**
 * Member profile (crm-ux-blueprint §5).
 *
 * The fee card answers the only question that matters at the desk — paid until when —
 * in words and colour. Then the three things staff actually do: call, WhatsApp, take
 * fees. History is below that, not above it.
 */

export const dynamic = 'force-dynamic';

/**
 * "October 2026" — the month on its own.
 *
 * Not `formatISTDate` with the day trimmed off: that reads the day out of a formatted
 * string, which is a different string in Hindi and would quietly leave a stray number.
 */
function monthLabel(month: string, locale: 'en' | 'hi'): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-IN' : 'hi-IN', {
    timeZone: 'Asia/Kolkata',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${month}T00:00:00+05:30`));
}

export default async function CrmMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor, gym, today, reader } = await requireCrmContext();
  const t = await getTranslations('crm');
  const locale = actor.language;
  const { id } = await params;

  const member = await reader.member(gym.id, id, today);
  if (member === null) notFound();

  // Only a trainer and above sees the diet plan, the same rule as starting one (ADR-089).
  const dietPlans = can(actor, 'diet.manage', getContainer().clock.now()) ? await dietReader().overview.plansFor(gym.id, id, 5) : [];

  const { clock, storage } = getContainer();
  // Photos are private objects, shown through a link that lapses in five minutes
  // (CLAUDE.md §2.8) — long enough to look at the page, too short to share.
  const photoUrl = member.photoKey === null ? null : await storage.signedUrl(member.photoKey, 300);
  // A member's ID photographs are for the people who check identity at the desk, which
  // is the same set `verification.approve` names — a trainer never sees them (ADR-077).
  const maySeeId = can(actor, 'verification.approve', clock.now());
  // A mandate needs a real gateway. In DEMO_MODE the panel says so rather than offering a
  // button that would make a subscription nobody can authorise.
  const onlinePayments = onlinePaymentsLive();
  const govIdPhotos = !maySeeId
    ? []
    : await Promise.all(member.govIdPhotos.map(async (photo) => ({ side: photo.side, url: await storage.signedUrl(photo.storageKey, 300) })));
  const mayTakeFees = can(actor, 'payment.record', clock.now());
  const mayEdit = can(actor, 'member.edit', clock.now());
  // The button shows for a role that may void; the PIN it then asks for is what actually
  // permits it (security-plan.md §3.1).
  const mayVoid = mayAfterPinEntry(actor, 'payment.void', clock.now());
  // Owner only, and hidden rather than disabled for everyone else (crm-ux-blueprint §16).
  const mayManageData = mayAfterPinEntry(actor, 'member.erase', clock.now());
  const exportReady = can(actor, 'member.export', clock.now());
  // The newest membership is the one the desk is asked about.
  const current = member.memberships[0] ?? null;
  const planLine =
    current === null
      ? null
      : current.isTrial
        ? // A trial is not a plan; calling it one would hide why it is three days long (ADR-088).
          t('profile.trialDays', { count: current.trialDays ?? 0 })
        : current.durationMonths === null
          ? t('profile.planUnknownLength')
          : t('profile.plan', { count: current.durationMonths });
  // "Settlement" is what the money behind this plan is: a payment taken here, or an
  // amount the member declared at the QR and the desk has yet to collect (ADR-086).
  const settlementLine =
    current === null
      ? null
      : current.pricePaise === 0
        ? t('profile.settlementNone')
        : current.isDeclared
          ? t('profile.settlementDeclared', { amount: rupees(current.pricePaise) })
          : t('profile.settlementPaid', { amount: rupees(current.pricePaise) });

  const daysInMonth = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0).getDate();
  const attended = new Set(member.attendanceDays);
  // What the WhatsApp button opens with. An empty chat means reception types the same
  // sentence forty times a week; this is that sentence, in their language, already there.
  // It is a convenience, not a tracked send — the reminder engine owns real messages.
  const whatsappText =
    member.effectiveEndDate === null || member.daysLeft === null
      ? t('profile.whatsappPrefillPlain', { name: member.fullName.split(' ')[0] ?? member.fullName })
      : t(member.daysLeft < 0 ? 'profile.whatsappPrefillOverdue' : 'profile.whatsappPrefillDue', {
          name: member.fullName.split(' ')[0] ?? member.fullName,
          date: formatISTDate(member.effectiveEndDate, locale),
        });

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
      <CrmHeader
        title={member.fullName}
        back="/crm/members"
        right={
          <MemberActionsMenu
            memberId={member.id}
            memberName={member.fullName}
            mayEdit={mayEdit}
            mayManageData={mayManageData}
            exportReady={exportReady}
            unlock={unlockMemberDataAction}
            erase={eraseMemberAction}
          />
        }
      />

      <div className="bg-white px-4 pt-4 pb-5 lg:rounded-panel lg:border lg:border-brand-stone/15 lg:p-6 lg:shadow-sm">
        <div className="flex items-center gap-4">
          {photoUrl === null ? (
            <span
              aria-hidden
              className={cn('flex size-20 shrink-0 items-center justify-center rounded-full font-display text-display-m font-bold text-brand-white', FEE_TONE[member.feeState].band)}
            >
              {initials(member.fullName)}
            </span>
          ) : (
            // Opens here, not in a new tab: the desk keeps the record it is looking at.
            <PhotoViewer url={photoUrl} alt={t('profile.photoAlt', { name: member.fullName })}>
              {/* A signed, short-lived URL to a private file: next/image would cache it. */}
              <img
                src={photoUrl}
                alt={t('profile.photoAlt', { name: member.fullName })}
                width={96}
                height={96}
                className="size-20 shrink-0 rounded-full object-cover ring-2 ring-brand-accent/30"
              />
            </PhotoViewer>
          )}
          <div className="min-w-0">
            <p className="truncate font-display text-display-m leading-tight font-bold text-brand-obsidian">{member.fullName}</p>
            <p className="text-crm-body text-brand-stone">{member.memberCode ?? '—'}</p>
          </div>
        </div>

        <div className={`mt-4 rounded-panel p-4 text-left ${FEE_TONE[member.feeState].chip}`}>
          <p className="text-crm-body font-bold">
            {t(`feeState.${member.feeState}`)}
            {member.effectiveEndDate === null ? '' : ` — ${t('feeState.till', { date: formatISTDate(member.effectiveEndDate, locale) })}`}
          </p>
          {feeLine === t(`feeState.${member.feeState}`) ? null : <p className="text-crm-body">{feeLine}</p>}
        </div>

        {/* Everything the desk might be asked for, in one place, every row present even
            when it is empty — a hidden field reads as "we never asked" (ADR-086). */}
        <dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-brand-stone/15 pt-4 sm:grid-cols-2">
          {(
            [
              // The whole number, readable and copyable: the desk has to ring it.
              ['mobile', displayPhone(member.mobile)],
              ['email', member.email],
              ['dob', member.dob === null ? null : formatISTDate(member.dob, locale)],
              ['gender', t(`gender.${member.gender}` as never)],
              ['joinedOn', member.joinedOn === null ? null : formatISTDate(member.joinedOn, locale)],
              ['slot', member.trainingSlot === null ? null : t(`verify.slot.${member.trainingSlot}` as never)],
              // While a QR declaration is waiting, it fills these rather than "not given":
              // the member did answer, and saying otherwise sends staff looking for a bug.
              ['plan', planLine ?? (member.declared === null ? null : t('profile.declaredPlan', { count: member.declared.planMonths ?? 0 }))],
              [
                'settlement',
                settlementLine ??
                  (member.declared?.endDate == null ? null : t('profile.declaredUntil', { date: formatISTDate(member.declared.endDate, locale) })),
              ],
              ['status', t(`status.${member.status}` as never)],
            ] as const
          ).map(([key, value]) => (
            // `min-w-0` on the row and `break-all` on the value, because an email address is
            // one unbroken word. A real member with a long one pushed this card to 453px on a
            // 390px phone and took the whole page sideways with it — the label held its width,
            // the value refused to wrap, and a flex item will not shrink below its content
            // without `min-w-0`.
            <div key={key} className="flex min-w-0 items-baseline justify-between gap-3 sm:block">
              <dt className="shrink-0 text-small text-brand-stone">{t(`profile.field.${key}` as never)}</dt>
              <dd
                className={cn(
                  'min-w-0 break-all text-right text-crm-body sm:text-left',
                  value === null || value === '' ? 'text-brand-stone italic' : 'font-semibold text-brand-obsidian',
                )}
              >
                {value === null || value === '' ? t('profile.notGiven') : value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <a
            href={`tel:${member.mobile}`}
            className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-panel bg-brand-obsidian text-small font-semibold text-white transition-transform hover:-translate-y-0.5"
          >
            <CrmIcon name="calls" className="size-5" />
            {t('profile.call')}
          </a>
          <a
            href={`https://wa.me/${member.mobile.replace(/\D/g, '')}?text=${encodeURIComponent(whatsappText)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-panel border-2 border-brand-obsidian text-small font-semibold text-brand-obsidian transition-colors hover:bg-brand-obsidian hover:text-brand-white"
          >
            <CrmIcon name="whatsapp" className="size-5" />
            {t('profile.whatsapp')}
          </a>
          {mayTakeFees ? (
            <Link
              href={`/crm/members/${member.id}/renew`}
              className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-panel bg-brand-accent text-small font-semibold text-brand-white transition-transform hover:-translate-y-0.5"
            >
              <CrmIcon name="fees" className="size-5" />
              {t('profile.takeFees')}
            </Link>
          ) : null}
        </div>
      </div>

      {/* A declaration that nobody has approved yet. The member filled the form in and is
          waiting; until somebody acts there is no membership, no fee date that counts and
          no reminder — so the screen says so, and says where to go (ADR-075). */}
      {member.declared === null ? null : (
        <section className="mt-3 rounded-panel border border-semantic-fee-due/40 bg-tint-fee-due-bg px-4 py-4 lg:px-6">
          <h2 className="text-crm-body font-bold text-brand-obsidian">{t('profile.declaredTitle')}</h2>
          <p className="mt-1 text-crm-body text-brand-obsidian">
            {t('profile.declaredBody', {
              plan: member.declared.planMonths === null ? t('profile.notGiven') : t('profile.plan', { count: member.declared.planMonths }),
              date: member.declared.endDate === null ? t('profile.notGiven') : formatISTDate(member.declared.endDate, locale),
            })}
          </p>
          <Link
            href="/crm/verify"
            className="mt-3 inline-flex min-h-14 items-center rounded-button bg-brand-obsidian px-5 text-crm-body font-semibold text-brand-white"
          >
            {t('profile.declaredCheck', { code: member.declared.referenceCode })}
          </Link>
        </section>
      )}

      {!maySeeId || govIdPhotos.length === 0 ? null : (
        <section className="mt-3 bg-white px-4 py-4 lg:rounded-panel lg:border lg:border-brand-stone/15 lg:px-6 lg:shadow-sm">
          <h2 className="text-crm-body font-bold text-brand-obsidian">{t('profile.idOnFile')}</h2>
          <GovIdStrip type={member.govIdType} photos={govIdPhotos} />
        </section>
      )}

      {/* Personal training, when they have it (ADR-087): the current term first, because
          "is their trainer still paid for" is the question the desk gets asked. */}
      {member.ptEnrolments.length === 0 ? null : (
        <section className="mt-3 bg-white px-4 py-4 lg:rounded-panel lg:border lg:border-brand-stone/15 lg:px-6 lg:shadow-sm">
          <h2 className="text-crm-body font-bold text-brand-obsidian">{t('profile.pt')}</h2>
          <ul className="mt-2 divide-y divide-brand-stone/15">
            {member.ptEnrolments.map((pt) => {
              const running = pt.status === 'CONFIRMED' && pt.endDate >= today;
              return (
                <li key={pt.id} className="flex items-baseline justify-between gap-3 py-3">
                  <span>
                    <span className="block text-crm-body font-semibold text-brand-obsidian">{t('profile.ptMonths', { count: pt.durationMonths })}</span>
                    <span className="block text-small text-brand-stone">
                      {formatISTDate(pt.startDate, locale)} – {formatISTDate(pt.endDate, locale)}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-crm-body font-semibold">{rupees(pt.pricePaise)}</span>
                    <span
                      className={cn(
                        'mt-1 inline-block rounded-full px-2.5 py-0.5 text-small font-semibold',
                        pt.status !== 'CONFIRMED' ? FEE_TONE.NONE.chip : running ? FEE_TONE.PAID.chip : FEE_TONE.EXPIRED.chip,
                      )}
                    >
                      {t(pt.status === 'CONFIRMED' ? (running ? 'profile.ptRunning' : 'profile.ptEnded') : 'profile.ptUnpaid')}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Autopay (ADR-105). Above the history, because "will their fee arrive by itself?"
          is a question about now — and because a halted mandate is invisible everywhere
          else on this page: the member still reads as paid up. */}
      <AutopayPanel
        memberId={member.id}
        mandate={
          member.mandate === null
            ? null
            : {
                id: member.mandate.id,
                status: member.mandate.status,
                amount: rupees(member.mandate.amountPaise),
                intervalMonths: member.mandate.intervalMonths,
                shortUrl: member.mandate.shortUrl,
                nextChargeOn: member.mandate.nextChargeOn === null ? null : formatISTDate(member.mandate.nextChargeOn, locale),
                chargeCount: member.mandate.chargeCount,
                authorised: member.mandate.authorisedAt !== null,
              }
        }
        canManage={can(actor, 'payment.record', clock.now())}
        available={onlinePayments}
        onStart={startAutopayAction}
        onCancel={cancelAutopayAction}
      />

      {/* The diet plan, when they have one (ADR-089). Staff get asked "what are they meant
          to be eating?", so the current plan is here in full rather than behind a link. */}
      {dietPlans.length === 0 ? null : <DietPanel plans={dietPlans} locale={locale} />}

      <section className="mt-3 bg-white px-4 py-4 lg:rounded-panel lg:border lg:border-brand-stone/15 lg:px-6 lg:shadow-sm">
        <h2 className="text-crm-body font-bold text-brand-obsidian">{t('profile.attendanceMonth')}</h2>
        <div className="mt-3 grid grid-cols-7 gap-2" aria-hidden>
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => (
            <span
              key={day}
              className={`flex size-8 items-center justify-center rounded-full text-small ${
                attended.has(day) ? 'bg-semantic-fee-paid text-white' : 'bg-tint-fee-none-bg text-brand-stone'
              }`}
            >
              {day}
            </span>
          ))}
        </div>
        <p className="mt-3 text-crm-body">{t('profile.attendanceDays', { count: member.attendanceDays.length })}</p>

        {/* Every month, not just this one (owner, 2026-10-07). The whole history was in the
            database and invisible, while "has this member been coming?" is the question this
            screen exists to answer — and the month a member stopped is the one worth seeing. */}
        {member.attendanceByMonth.length === 0 ? null : (
          <details className="mt-4 border-t border-brand-stone/15 pt-3">
            <summary className="min-h-14 cursor-pointer list-none text-crm-body font-semibold text-brand-crimson">
              {t('profile.attendanceAll', { count: member.attendanceTotalDays })}
            </summary>
            <ul className="mt-2 divide-y divide-brand-stone/15">
              {member.attendanceByMonth.map((row) => (
                <li key={row.month} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="text-crm-body text-brand-obsidian">{monthLabel(row.month, locale)}</span>
                  <span className="text-crm-body font-semibold text-brand-obsidian">{t('profile.attendanceDays', { count: row.days })}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="mt-3 bg-white px-4 py-4 lg:rounded-panel lg:border lg:border-brand-stone/15 lg:px-6 lg:shadow-sm">
        <h2 className="text-crm-body font-bold text-brand-obsidian">{t('profile.plansAndMoney')}</h2>
        {member.payments.length === 0 ? (
          <p className="mt-2 text-crm-body text-brand-stone">{t('profile.noPayments')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-brand-stone/15">
            {member.payments.map((payment) => (
              <li key={payment.id} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span>
                    <span className={`block text-crm-body font-semibold ${payment.status === 'VOIDED' ? 'text-brand-stone line-through' : ''}`}>
                      {rupees(payment.amountPaise)}
                    </span>
                    <span className="block text-small text-brand-stone">
                      {payment.receiptNo === null
                        ? t(`profile.paymentStatus.${payment.status}` as never)
                        : t('profile.receipt', { receiptNo: payment.receiptNo })}
                      {payment.status === 'VOIDED' ? ` — ${t('void.voided')}` : ''}
                    </span>
                  </span>
                  <span className="text-small text-brand-stone">{t(`profile.method.${payment.method}` as never)}</span>
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
        <ul className="mt-4 divide-y divide-brand-stone/15">
          {member.memberships.map((membership) => (
            <li key={membership.id} className="flex items-baseline justify-between gap-3 py-3 text-crm-body">
              <span>
                {membership.durationMonths === null
                  ? '—'
                  : membership.durationMonths === 1
                    ? t('profile.monthly')
                    : t('profile.months', { count: membership.durationMonths })}
              </span>
              <span className="text-small text-brand-stone">
                {membership.startDate === null ? '' : `${formatISTDate(membership.startDate, locale)} – `}
                {formatISTDate(membership.endDate, locale)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <BottomNav active="members" />
    </>
  );
}
