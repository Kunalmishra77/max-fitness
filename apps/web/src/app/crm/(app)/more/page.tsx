import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { BottomNav, CrmHeader } from '@/components/crm/crm-chrome';
import { can, mayAfterPinEntry } from '@mfp/core';
import { getContainer } from '@/lib/container';
import { requireCrmContext, verificationDeps } from '@/lib/crm';

/**
 * "और" — the rest of the CRM (crm-ux-blueprint §2).
 *
 * Only the calls list exists so far; the others are named here so the owner can see
 * what is coming, without pretending they work.
 */

export const dynamic = 'force-dynamic';

export default async function CrmMorePage() {
  const { actor, gym } = await requireCrmContext();
  const t = await getTranslations('crm');
  // Reports are mostly money, so the link is shown to whoever may see money.
  const showReports = can(actor, 'money.view', getContainer().clock.now());
  // Settings ask for the PIN on the way in; the link shows to whoever the PIN would admit.
  const showSettings = mayAfterPinEntry(actor, 'settings.manage', getContainer().clock.now());
  const showImport = mayAfterPinEntry(actor, 'member.import', getContainer().clock.now());
  const showVerify = can(actor, 'verification.approve', getContainer().clock.now());
  const waiting = showVerify ? await verificationDeps().queue.count(gym.id) : 0;

  return (
    <>
      <CrmHeader title={t('nav.more')} back="/crm" />
      <ul className="divide-y divide-brand-rubber-grey/15">
        <li>
          <Link href="/crm/more/pin" className="flex min-h-16 items-center justify-between bg-white px-4 text-crm-body font-semibold">
            🔑 {t('pin.link')}
            <span aria-hidden className="text-xl text-brand-rubber-grey">
              ›
            </span>
          </Link>
        </li>
        <li>
          <Link href="/crm/calls" className="flex min-h-16 items-center justify-between bg-white px-4 text-crm-body font-semibold">
            📞 {t('calls.title')}
            <span aria-hidden className="text-xl text-brand-rubber-grey">
              ›
            </span>
          </Link>
        </li>
        {showSettings ? (
          <li>
            <Link href="/crm/settings/staff" className="flex min-h-16 items-center justify-between bg-white px-4 text-crm-body font-semibold">
              👥 {t('staff.title')}
              <span aria-hidden className="text-xl text-brand-rubber-grey">
                ›
              </span>
            </Link>
          </li>
        ) : null}
        {showSettings ? (
          <li>
            <Link href="/crm/settings" className="flex min-h-16 items-center justify-between bg-white px-4 text-crm-body font-semibold">
              ⚙️ {t('settings.title')}
              <span aria-hidden className="text-xl text-brand-rubber-grey">
                ›
              </span>
            </Link>
          </li>
        ) : null}
        {showVerify ? (
          <li>
            <Link href="/crm/verify" className="flex min-h-16 items-center justify-between bg-white px-4 text-crm-body font-semibold">
              <span>
                ✅ {t('verify.link')}
                {waiting > 0 ? <span className="ml-2 rounded-full bg-brand-signboard-red px-2 py-0.5 text-small text-white">{waiting}</span> : null}
              </span>
              <span aria-hidden className="text-xl text-brand-rubber-grey">
                ›
              </span>
            </Link>
          </li>
        ) : null}
        {showImport ? (
          <li>
            <Link href="/crm/import" className="flex min-h-16 items-center justify-between bg-white px-4 text-crm-body font-semibold">
              📥 {t('import.title')}
              <span aria-hidden className="text-xl text-brand-rubber-grey">
                ›
              </span>
            </Link>
          </li>
        ) : null}
        {showReports ? (
          <li>
            <Link href="/crm/reports" className="flex min-h-16 items-center justify-between bg-white px-4 text-crm-body font-semibold">
              📊 {t('reports.title')}
              <span aria-hidden className="text-xl text-brand-rubber-grey">
                ›
              </span>
            </Link>
          </li>
        ) : null}
        <li>
          <Link href="/crm/leads" className="flex min-h-16 items-center justify-between bg-white px-4 text-crm-body font-semibold">
            🔵 {t('leads.title')}
            <span aria-hidden className="text-xl text-brand-rubber-grey">
              ›
            </span>
          </Link>
        </li>
      </ul>
      <div className="p-6 text-center">
        <h2 className="font-display text-title font-bold text-brand-plate-navy">{t('soon.title')}</h2>
        <p className="mt-2 text-crm-body text-brand-rubber-grey">{t('soon.body')}</p>
      </div>
      <BottomNav active="more" />
    </>
  );
}
