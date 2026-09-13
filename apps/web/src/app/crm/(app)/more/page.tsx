import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { BottomNav, CrmHeader } from '@/components/crm/crm-chrome';
import { requireCrmContext } from '@/lib/crm';

/**
 * "और" — the rest of the CRM (crm-ux-blueprint §2).
 *
 * Only the calls list exists so far; the others are named here so the owner can see
 * what is coming, without pretending they work.
 */

export const dynamic = 'force-dynamic';

export default async function CrmMorePage() {
  await requireCrmContext();
  const t = await getTranslations('crm');

  return (
    <>
      <CrmHeader title={t('nav.more')} back="/crm" />
      <ul className="divide-y divide-brand-rubber-grey/15">
        <li>
          <Link href="/crm/calls" className="flex min-h-16 items-center justify-between bg-white px-4 text-crm-body font-semibold">
            📞 {t('calls.title')}
            <span aria-hidden className="text-xl text-brand-rubber-grey">
              ›
            </span>
          </Link>
        </li>
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
