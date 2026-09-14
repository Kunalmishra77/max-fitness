import { getTranslations } from 'next-intl/server';
import { can, mayAfterPinEntry } from '@mfp/core';
import { savePlanPricesAction, saveSettingsAction, unlockSettingsAction } from '@/app/crm/actions';
import { BottomNav, CrmHeader } from '@/components/crm/crm-chrome';
import { HoursForm, JoiningForm, PricesForm, PromoForm, SettingsUnlock, TrustForm } from '@/components/crm/settings-forms';
import { getContainer } from '@/lib/container';
import { requireCrmContext } from '@/lib/crm';

/**
 * Settings — "सेटिंग" (crm-ux-blueprint §14; ADR-047).
 *
 * Owner only, behind the PIN. What is here first is what the client has not yet
 * decided and the owner should be able to decide alone: plan prices, the admission fee
 * and the minimum age; then the website's offer, trust numbers and opening hours. Staff,
 * the kiosk, reminder times, language and voice follow in later slices.
 */

export const dynamic = 'force-dynamic';

export default async function CrmSettingsPage() {
  const { actor, gym } = await requireCrmContext();
  const t = await getTranslations('crm');
  const { clock, prisma } = getContainer();
  const now = clock.now();

  if (!mayAfterPinEntry(actor, 'settings.manage', now)) {
    return (
      <>
        <CrmHeader title={t('settings.title')} back="/crm/more" />
        <p role="alert" className="m-4 rounded-panel bg-tint-fee-none-bg p-4 text-crm-body font-semibold text-brand-plate-navy">
          {t('settings.notAllowed')}
        </p>
        <BottomNav active="more" />
      </>
    );
  }

  if (!can(actor, 'settings.manage', now)) {
    return (
      <>
        <CrmHeader title={t('settings.title')} back="/crm/more" />
        <SettingsUnlock unlock={unlockSettingsAction} />
        <BottomNav active="more" />
      </>
    );
  }

  const plans = await prisma.plan.findMany({
    where: { gymId: gym.id, isActive: true, gender: { in: ['MALE', 'FEMALE'] } },
    select: { code: true, gender: true, durationMonths: true, pricePaise: true },
    orderBy: [{ gender: 'asc' }, { durationMonths: 'asc' }],
  });
  const { pricing, privacy, promo, trust, hours } = gym.settings;

  return (
    <>
      <CrmHeader title={t('settings.title')} back="/crm/more" />
      <div className="grid gap-3 p-4 pb-24">
        <PricesForm
          plans={plans.map((plan) => ({ code: plan.code, gender: plan.gender as 'MALE' | 'FEMALE', durationMonths: plan.durationMonths, pricePaise: plan.pricePaise }))}
          save={savePlanPricesAction}
          unlock={unlockSettingsAction}
        />
        <JoiningForm admissionFeeRupees={pricing.admissionFeePaise / 100} minAge={privacy.minAge} save={saveSettingsAction} unlock={unlockSettingsAction} />
        <PromoForm enabled={promo.enabled} textHi={promo.textHi} textEn={promo.textEn} save={saveSettingsAction} unlock={unlockSettingsAction} />
        <TrustForm trust={trust} save={saveSettingsAction} unlock={unlockSettingsAction} />
        <HoursForm hours={hours} save={saveSettingsAction} unlock={unlockSettingsAction} />
      </div>
      <BottomNav active="more" />
    </>
  );
}
