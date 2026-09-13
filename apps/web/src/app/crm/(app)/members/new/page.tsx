import { getTranslations } from 'next-intl/server';
import { can } from '@mfp/core';
import { addMemberAction } from '@/app/crm/actions';
import { AddMemberFlow } from '@/components/crm/add-member-flow';
import { CrmHeader } from '@/components/crm/crm-chrome';
import { getContainer } from '@/lib/container';
import { requireCrmContext } from '@/lib/crm';

/**
 * Add a member at the desk (crm-ux-blueprint §7).
 *
 * One question per screen, photo first and skippable, then straight on to fees — the
 * walk-in who joins and pays in one visit is the common case. Permission is checked
 * here so a trainer never sees the form, and again in the service.
 */

export const dynamic = 'force-dynamic';

export default async function CrmAddMemberPage() {
  const { actor } = await requireCrmContext();
  const t = await getTranslations('crm');

  if (!can(actor, 'member.edit', getContainer().clock.now())) {
    return (
      <>
        <CrmHeader title={t('add.title')} back="/crm/members" />
        <p role="alert" className="m-4 rounded-panel bg-tint-fee-expired-bg p-4 text-crm-body font-semibold text-semantic-fee-expired">
          {t('add.notAllowed')}
        </p>
      </>
    );
  }

  return (
    <>
      <CrmHeader title={t('add.title')} back="/crm/members" />
      <AddMemberFlow action={addMemberAction} />
    </>
  );
}
