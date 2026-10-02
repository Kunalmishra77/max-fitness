import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { can } from '@mfp/core';
import { editMemberAction } from '@/app/crm/actions';
import { CrmHeader } from '@/components/crm/crm-chrome';
import { MemberEditForm } from '@/components/crm/member-edit-form';
import { getContainer } from '@/lib/container';
import { memberEditDeps, requireCrmContext } from '@/lib/crm';

/**
 * Correcting a member's details (crm-ux-blueprint §5).
 *
 * The form is filled from the row itself rather than from the profile's read model, so what
 * the desk edits is exactly what is stored — the profile formats dates for reading, and a
 * formatted date is not what goes back into the column.
 */

export const dynamic = 'force-dynamic';

export default async function CrmEditMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor, gym } = await requireCrmContext();
  const t = await getTranslations('crm');
  const { id } = await params;

  if (!can(actor, 'member.edit', getContainer().clock.now())) {
    return (
      <>
        <CrmHeader title={t('edit.title')} back={`/crm/members/${id}`} />
        <p role="alert" className="m-4 rounded-panel bg-tint-fee-expired-bg p-4 text-crm-body font-semibold text-semantic-fee-expired">
          {t('edit.errors.FORBIDDEN')}
        </p>
      </>
    );
  }

  const member = await memberEditDeps().uow.transaction((store) => store.findMemberForEdit(gym.id, id));
  if (member === null || member.deletedAt !== null) notFound();

  return (
    <>
      <CrmHeader title={member.fullName} subtitle={t('edit.title')} back={`/crm/members/${id}`} />
      <MemberEditForm
        memberId={member.id}
        initial={{
          fullName: member.fullName,
          mobile: member.mobile,
          email: member.email ?? '',
          dob: member.dob ?? '',
          gender: member.gender,
          language: member.language,
          trainingSlot: member.trainingSlot ?? '',
          joinedOn: member.joinedOn ?? '',
          notes: member.notes ?? '',
          whatsappOptIn: member.whatsappOptIn,
        }}
        save={editMemberAction}
      />
    </>
  );
}
