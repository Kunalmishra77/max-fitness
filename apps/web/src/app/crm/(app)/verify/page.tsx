import { getTranslations } from 'next-intl/server';
import { can } from '@mfp/core';
import { maskMobile } from '@mfp/shared';
import { approveVerificationAction, rejectVerificationAction } from '@/app/crm/actions';
import { BottomNav, CrmHeader } from '@/components/crm/crm-chrome';
import { VerifyQueue, type VerifyItem } from '@/components/crm/verify-queue';
import { getContainer } from '@/lib/container';
import { requireCrmContext, verificationDeps } from '@/lib/crm';

/**
 * "जाँचें" — members who sent their details by QR (crm-ux-blueprint §9; ADR-058).
 *
 * Owner and reception decide them; a trainer is told so. Photos — the selfie and each
 * side of the government ID (ADR-074) — come through the same five-minute signed links
 * as the member profile.
 */

export const dynamic = 'force-dynamic';

export default async function CrmVerifyPage() {
  const { actor, gym } = await requireCrmContext();
  const t = await getTranslations('crm.verify');
  const { clock, storage } = getContainer();

  if (!can(actor, 'verification.approve', clock.now())) {
    return (
      <>
        <CrmHeader title={t('title')} back="/crm/more" />
        <p role="alert" className="m-4 rounded-panel bg-tint-fee-none-bg p-4 text-crm-body font-semibold text-brand-obsidian">
          {t('errors.notAllowed')}
        </p>
        <BottomNav active="more" />
      </>
    );
  }

  const pending = await verificationDeps().queue.pending(gym.id);
  const items: VerifyItem[] = await Promise.all(
    pending.map(async (row) => ({
      id: row.id,
      referenceCode: row.referenceCode,
      fullName: row.member.fullName,
      mobileMasked: maskMobile(row.member.mobile),
      photoUrl: row.member.photoKey === null ? null : await storage.signedUrl(row.member.photoKey, 300),
      planMonths: row.declaredPlanMonths,
      declaredEndDate: row.declaredEndDate,
      declaredAmountPaise: row.declaredAmountPaise,
      register: row.register === null ? null : { endDate: row.register.endDate, planMonths: row.register.planMonths },
      joinedOn: row.member.joinedOn,
      govIdType: row.govIdType,
      govIdPhotos: await Promise.all(
        row.govIdPhotos.map(async (photo) => ({ side: photo.side, url: await storage.signedUrl(photo.storageKey, 300) })),
      ),
    })),
  );

  return (
    <>
      <CrmHeader title={t('title')} back="/crm/more" />
      <p className="px-4 pt-4 text-small text-brand-stone">{t('helper')}</p>
      <VerifyQueue items={items} approve={approveVerificationAction} reject={rejectVerificationAction} />
      <BottomNav active="more" />
    </>
  );
}
