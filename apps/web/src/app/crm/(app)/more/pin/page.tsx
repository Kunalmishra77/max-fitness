import { getTranslations } from 'next-intl/server';
import { changeOwnPinAction } from '@/app/crm/actions';
import { BottomNav, CrmHeader } from '@/components/crm/crm-chrome';
import { OwnPinForm } from '@/components/crm/own-pin-form';
import { requireCrmContext } from '@/lib/crm';

/**
 * Change my PIN (security-plan §3.1, §6; ADR-049).
 *
 * Open to every role: it is the one account setting each person owns. The current PIN is
 * the proof; no fresh-PIN gate is needed in front of a form that asks for the PIN.
 */

export const dynamic = 'force-dynamic';

export default async function CrmOwnPinPage() {
  await requireCrmContext();
  const t = await getTranslations('crm');

  return (
    <>
      <CrmHeader title={t('pin.title')} subtitle={t('menu.pin.desc')} back="/crm/more" />
      <div className="p-4 pb-24">
        <OwnPinForm action={changeOwnPinAction} />
      </div>
      <BottomNav active="more" />
    </>
  );
}
