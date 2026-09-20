import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { can, type LeadStatus } from '@mfp/core';
import { formatISTDate, toISTDate } from '@mfp/shared';
import { advanceLeadAction } from '@/app/crm/actions';
import { BottomNav, CrmHeader, CRM_CARD, pillClass } from '@/components/crm/crm-chrome';
import { CrmIcon } from '@/components/crm/crm-icons';
import { cn } from '@/lib/cn';
import { LeadActions } from '@/components/crm/lead-actions';
import { getContainer } from '@/lib/container';
import { requireCrmContext } from '@/lib/crm';

/**
 * Enquiries — "पूछताछ" (BR-10.1; crm-ux-blueprint §12).
 *
 * Every enquiry from the website lands here, and until now the owner could not see a
 * single one of them. Open ones first, each with the two things staff do — call or
 * WhatsApp — and one button to say what came of it.
 */

export const dynamic = 'force-dynamic';

const TONE: Record<string, string> = {
  NEW: 'bg-tint-fee-due-soon-bg text-semantic-fee-due-soon',
  CONTACTED: 'bg-tint-fee-none-bg text-brand-obsidian',
  TRIAL_BOOKED: 'bg-tint-fee-none-bg text-brand-obsidian',
  VISITED: 'bg-tint-fee-none-bg text-brand-obsidian',
  CONVERTED: 'bg-tint-fee-paid-bg text-semantic-fee-paid',
  LOST: 'bg-tint-fee-expired-bg text-semantic-fee-expired',
};

export default async function CrmLeadsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { actor, gym, reader } = await requireCrmContext();
  const t = await getTranslations('crm');
  const { tab } = await searchParams;

  const all = tab === 'all';
  const leads = await reader.leads(gym.id, { open: !all });
  const mayWork = can(actor, 'member.edit', getContainer().clock.now());

  const tabClass = (active: boolean) =>
    pillClass(active);

  return (
    <>
      <CrmHeader title={t('leads.title')} subtitle={t('menu.leads.desc')} back="/crm/more" />

      <div className="flex gap-2 px-4 py-3">
        <Link href="/crm/leads" className={tabClass(!all)}>
          {t('leads.tabOpen')}
        </Link>
        <Link href="/crm/leads?tab=all" className={tabClass(all)}>
          {t('leads.tabAll')}
        </Link>
      </div>

      <p className="px-4 pb-2 text-small text-brand-stone">{t('leads.count', { count: leads.length })}</p>

      {leads.length === 0 ? (
        <p className="px-4 py-8 text-center text-crm-body text-brand-stone">{t('leads.empty')}</p>
      ) : (
        <ul className="divide-y divide-brand-stone/15">
          {leads.map((lead) => (
            <li key={lead.id} className={cn(CRM_CARD, 'p-4 lg:mb-3')}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-crm-body font-semibold text-brand-ink">{lead.name}</span>
                <span className={`shrink-0 rounded-button px-2 py-1 text-small font-semibold ${TONE[lead.status] ?? TONE['NEW'] ?? ''}`}>
                  {t(`leads.${lead.status}` as never)}
                </span>
              </div>
              <p className="mt-1 text-small text-brand-stone">
                {t('leads.askedOn', { date: formatISTDate(toISTDate(lead.createdAt), actor.language) })}
                {lead.goal === null ? '' : ` · ${t('leads.goal', { goal: lead.goal })}`}
              </p>
              {lead.notes === null ? null : <p className="mt-2 text-small whitespace-pre-line text-brand-stone">{lead.notes}</p>}

              <div className="mt-3 grid grid-cols-2 gap-3">
                <a
                  href={`tel:${lead.mobile}`}
                  className="flex min-h-14 items-center justify-center gap-2 rounded-panel bg-brand-obsidian text-crm-body font-semibold text-white transition-transform hover:-translate-y-0.5"
                >
                  <CrmIcon name="calls" className="size-5" />
                  {t('profile.call')}
                </a>
                <a
                  href={`https://wa.me/${lead.mobile.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-14 items-center justify-center gap-2 rounded-panel border-2 border-brand-obsidian text-crm-body font-semibold text-brand-obsidian transition-colors hover:bg-brand-obsidian hover:text-brand-white"
                >
                  <CrmIcon name="whatsapp" className="size-5" />
                  {t('profile.whatsapp')}
                </a>
              </div>

              {mayWork && lead.status !== 'CONVERTED' && lead.status !== 'LOST' ? (
                <LeadActions leadId={lead.id} status={lead.status as LeadStatus} action={advanceLeadAction} />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <BottomNav active="more" />
    </>
  );
}
