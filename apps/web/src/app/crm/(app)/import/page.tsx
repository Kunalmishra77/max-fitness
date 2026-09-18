import { getTranslations } from 'next-intl/server';
import { mayAfterPinEntry } from '@mfp/core';
import { commitImportAction, previewImportAction } from '@/app/crm/actions';
import { BottomNav, CrmHeader } from '@/components/crm/crm-chrome';
import { ImportWizard } from '@/components/crm/import-wizard';
import { getContainer } from '@/lib/container';
import { requireCrmContext } from '@/lib/crm';

/**
 * "पुराना रजिस्टर जोड़ें" — bring in the paper register (crm-module-spec §7; ADR-056).
 *
 * Owner only. The PIN is asked at the moment of adding, next to the button, so the
 * owner can check a file as many times as needed first.
 */

export const dynamic = 'force-dynamic';

export default async function CrmImportPage() {
  const { actor } = await requireCrmContext();
  const t = await getTranslations('crm');
  const allowed = mayAfterPinEntry(actor, 'member.import', getContainer().clock.now());

  return (
    <>
      <CrmHeader title={t('import.title')} subtitle={t('menu.import.desc')} back="/crm/more" />
      {allowed ? (
        <ImportWizard preview={previewImportAction} commit={commitImportAction} />
      ) : (
        <p role="alert" className="m-4 rounded-panel bg-tint-fee-none-bg p-4 text-crm-body font-semibold text-brand-obsidian">
          {t('import.notAllowed')}
        </p>
      )}
      <BottomNav active="more" />
    </>
  );
}
