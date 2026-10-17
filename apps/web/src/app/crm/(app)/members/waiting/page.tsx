import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { can } from '@mfp/core';
import { BottomNav, CrmHeader, CRM_CARD } from '@/components/crm/crm-chrome';
import { CrmIcon } from '@/components/crm/crm-icons';
import { cn } from '@/lib/cn';
import { getContainer } from '@/lib/container';
import { requireCrmContext } from '@/lib/crm';
import { displayPhone } from '@/lib/site';

/**
 * Waiting for payment — people who filled the form and stopped (ADR-125).
 *
 * The owner found one of them sitting in the Members list beside people who train every
 * day, and asked how she had become a member. She had not. The register is for people
 * the gym has, so these moved here.
 *
 * **It is a worklist, not an archive.** Every row is somebody who wanted to join a few
 * minutes or a few days ago and got as far as the payment screen — the most likely new
 * member the gym has. So the row leads with how to reach them, and says how long they
 * have been waiting, because a call on the same evening is a different call from one a
 * fortnight later.
 *
 * Nobody is deleted here. They walk into the register by themselves the moment the
 * money lands, because the rule both screens read is the same one.
 */

export const dynamic = 'force-dynamic';

const DAY_MS = 86_400_000;

export default async function CrmWaitingForPaymentPage() {
  const { actor, gym, today, reader } = await requireCrmContext();
  const t = await getTranslations('crm');
  const { storage, clock } = getContainer();

  /**
   * SEC-011. This was the one screen listing members without asking first.
   *
   * It made no practical difference — every role holds `member.view` today — but it is a
   * list of names and unmasked mobile numbers, and security-plan.md §3.1 says deny by
   * default. Relying on the fact that no current role is excluded means the day somebody
   * narrows `member.view`, every sibling screen starts refusing and this one keeps
   * showing. The refusal matches the pattern the other screens use.
   */
  if (!can(actor, 'member.view', clock.now())) {
    return (
      <>
        <CrmHeader title={t('waiting.title')} back="/crm/members" />
        <p role="alert" className="m-4 rounded-panel bg-tint-fee-none-bg p-4 text-crm-body font-semibold text-brand-obsidian">
          {t('verify.errors.notAllowed')}
        </p>
        <BottomNav active="members" />
      </>
    );
  }

  const members = await reader.members(gym.id, today, { awaitingPayment: true, limit: 200 });
  const now = clock.now().getTime();

  const entries = await Promise.all(
    members.map(async (member) => ({
      member,
      photoUrl: member.photoKey === null ? null : await storage.signedUrl(member.photoKey, 300),
    })),
  );

  return (
    <>
      <CrmHeader title={t('waiting.title')} subtitle={t('waiting.subtitle')} back="/crm/members" />

      {entries.length === 0 ? (
        <p className="px-4 py-12 text-center text-crm-body text-brand-stone">{t('waiting.empty')}</p>
      ) : (
        <ul className="mt-3 grid gap-3">
          {entries.map(({ member, photoUrl }) => {
            // `joinedOn` is when they say they joined the gym; this screen is about when
            // they filled the form, which the fee row's end date stands in for.
            const waitingDays = member.effectiveEndDate === null ? null : Math.max(0, Math.round((now - Date.parse(`${member.effectiveEndDate}T00:00:00+05:30`)) / DAY_MS));

            return (
              <li key={member.id} className={cn(CRM_CARD, 'px-4 py-4')}>
                <div className="flex items-start gap-3">
                  {photoUrl === null ? (
                    <span className="grid size-14 shrink-0 place-items-center rounded-full bg-brand-stone/15 text-brand-stone">
                      <CrmIcon name="members" className="size-7" />
                    </span>
                  ) : (
                    // A signed link that lapses in five minutes; there is nothing for the
                    // image optimiser to cache, as the members list already found.
                    <img src={photoUrl} alt="" width={56} height={56} className="size-14 shrink-0 rounded-full object-cover" />
                  )}

                  <div className="min-w-0 flex-1">
                    <Link href={`/crm/members/${member.id}`} className="block text-crm-body font-bold text-brand-obsidian hover:underline">
                      {member.fullName}
                    </Link>
                    <p className="tabular text-small text-brand-stone">{displayPhone(member.mobile)}</p>
                    <p className="mt-1 text-small text-brand-stone">
                      {member.planMonths === null ? t('waiting.noPlan') : t('waiting.chose', { months: member.planMonths })}
                      {waitingDays === null ? '' : ` · ${t('waiting.since', { days: waitingDays })}`}
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <a
                    href={`tel:${member.mobile}`}
                    className="flex min-h-14 items-center justify-center gap-2 rounded-button bg-brand-obsidian px-3 text-crm-body font-semibold text-brand-white"
                  >
                    <CrmIcon name="calls" className="size-5" />
                    {t('profile.call')}
                  </a>
                  <Link
                    href={`/crm/messages?member=${member.id}`}
                    className="flex min-h-14 items-center justify-center gap-2 rounded-button border-2 border-brand-obsidian px-3 text-crm-body font-semibold text-brand-obsidian"
                  >
                    <CrmIcon name="whatsapp" className="size-5" />
                    {t('profile.whatsapp')}
                  </Link>
                  <Link
                    href={`/crm/members/${member.id}/renew`}
                    className="flex min-h-14 items-center justify-center gap-2 rounded-button bg-brand-accent px-3 text-crm-body font-semibold text-brand-white"
                  >
                    <CrmIcon name="fees" className="size-5" />
                    {t('profile.takeFees')}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <BottomNav active="members" />
    </>
  );
}
