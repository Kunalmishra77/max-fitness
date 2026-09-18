import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { can, mayAfterPinEntry } from '@mfp/core';
import { formatISTDateTime } from '@mfp/shared';
import { addStaffAction, resetStaffPinAction, saveSettingsAction, setStaffActiveAction, unlockSettingsAction } from '@/app/crm/actions';
import { BottomNav, CrmHeader } from '@/components/crm/crm-chrome';
import { SettingsUnlock } from '@/components/crm/settings-forms';
import { AddStaffForm, ReceptionFeesToggle, StaffList } from '@/components/crm/staff-manager';
import { getContainer } from '@/lib/container';
import { requireCrmContext, staffReader } from '@/lib/crm';

/**
 * Staff — who logs in (crm-ux-blueprint §14; ADR-048).
 *
 * Owner only, behind the PIN, like the rest of settings. The launch checklist wants the
 * demo PINs gone before real use; this is where the owner replaces them.
 */

export const dynamic = 'force-dynamic';

export default async function CrmStaffPage() {
  const { actor, gym } = await requireCrmContext();
  const t = await getTranslations('crm');
  const now = getContainer().clock.now();

  if (!mayAfterPinEntry(actor, 'settings.manage', now)) {
    return (
      <>
        <CrmHeader title={t('staff.title')} back="/crm/more" />
        <p role="alert" className="m-4 rounded-panel bg-tint-fee-none-bg p-4 text-crm-body font-semibold text-brand-obsidian">
          {t('settings.notAllowed')}
        </p>
        <BottomNav active="more" />
      </>
    );
  }

  if (!can(actor, 'settings.manage', now)) {
    return (
      <>
        <CrmHeader title={t('staff.title')} back="/crm/more" />
        <SettingsUnlock unlock={unlockSettingsAction} />
        <BottomNav active="more" />
      </>
    );
  }

  const staff = await staffReader().list(gym.id);

  return (
    <>
      <CrmHeader title={t('staff.title')} back="/crm/more" />
      <div className="grid gap-3 p-4 pb-24">
        <ReceptionFeesToggle enabled={gym.settings.pricing.receptionMayTakePayments} save={saveSettingsAction} unlock={unlockSettingsAction} />
        <StaffList
          rows={staff.map((row) => ({
            id: row.id,
            name: row.name,
            mobile: row.mobile,
            role: row.role,
            isActive: row.isActive,
            lastLogin: row.lastLoginAt === null ? null : formatISTDateTime(row.lastLoginAt, actor.language),
            isYou: row.id === actor.staffUserId,
          }))}
          resetPin={resetStaffPinAction}
          setActive={setStaffActiveAction}
          unlock={unlockSettingsAction}
        />
        <AddStaffForm add={addStaffAction} unlock={unlockSettingsAction} />
        <Link href="/crm/more/pin" className="flex min-h-14 items-center justify-between rounded-panel bg-white px-4 text-crm-body font-semibold shadow-sm">
          🔑 {t('pin.link')}
          <span aria-hidden className="text-xl text-brand-stone">
            ›
          </span>
        </Link>
      </div>
      <BottomNav active="more" />
    </>
  );
}
