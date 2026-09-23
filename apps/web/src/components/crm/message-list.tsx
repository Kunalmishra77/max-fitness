'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatISTDateTime } from '@mfp/shared';
import { cn } from '@/lib/cn';
import { CrmIcon, type CrmIconName } from './crm-icons';

/**
 * The message log as the owner reads it (crm-module-spec §8).
 *
 * The owner never asks "what did the provider return"; they ask "did Anita get her
 * reminder, and if not, why". So a row leads with the member and the purpose, shows how
 * far the message got, and — when it did not go — says the reason in words. A provider
 * code we have no words for is shown as it is, rather than guessed at.
 */

export interface MessageRow {
  readonly id: string;
  readonly memberId: string | null;
  readonly memberName: string | null;
  readonly direction: 'OUTBOUND' | 'INBOUND';
  readonly purpose: string;
  readonly status: string;
  readonly ruleCode: string | null;
  readonly bodyPreview: string | null;
  readonly errorCode: string | null;
  /** ISO instant. */
  readonly at: string;
}

const TONE: Record<string, string> = {
  DELIVERED: 'bg-tint-fee-paid-bg text-semantic-fee-paid',
  READ: 'bg-tint-fee-paid-bg text-semantic-fee-paid',
  SENT: 'bg-tint-fee-none-bg text-brand-stone',
  QUEUED: 'bg-tint-fee-none-bg text-brand-stone',
  SIMULATED: 'bg-tint-fee-due-soon-bg text-semantic-fee-due-soon',
  FAILED: 'bg-tint-fee-expired-bg text-semantic-fee-expired',
  SKIPPED: 'bg-tint-fee-expired-bg text-semantic-fee-expired',
};

const ICON: Record<string, CrmIconName> = {
  REMINDER: 'bell',
  RECEIPT: 'fees',
  WELCOME: 'members',
  VERIFICATION: 'verify',
  OTP: 'pin',
  OWNER_DIGEST: 'reports',
  OWNER_ALERT: 'bell',
  BIRTHDAY: 'cake',
  UNSUBSCRIBE_CONFIRM: 'whatsapp',
  RESTART_CONFIRM: 'whatsapp',
  OTHER: 'whatsapp',
};

export function MessageList({ rows }: { rows: readonly MessageRow[] }) {
  const t = useTranslations('crm.messages');
  const locale = useLocale();

  if (rows.length === 0) {
    return <p className="m-4 rounded-panel bg-white p-6 text-center text-crm-body text-brand-stone lg:m-0">{t('empty')}</p>;
  }

  /** Words for a skip reason we know; the raw code for one we do not. */
  const reasonText = (code: string): string => {
    const key = `reason.${code}`;
    const words = t.has(key as never) ? t(key as never) : null;
    return words ?? code;
  };

  return (
    <ul className="grid gap-3 p-4 pb-24 lg:p-0">
      {rows.map((row) => {
        const purposeKey = `purpose.${row.purpose}`;
        const statusKey = `status.${row.status}`;
        return (
          <li key={row.id}>
            <article
              aria-label={row.memberName ?? t('title')}
              className="rounded-panel border border-brand-stone/15 bg-white p-4 shadow-sm transition-colors hover:border-brand-stone/30"
            >
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-obsidian text-brand-white">
                  <CrmIcon name={ICON[row.purpose] ?? 'whatsapp'} className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-crm-body font-semibold text-brand-obsidian">{row.memberName ?? '—'}</span>
                    <span className="text-small text-brand-stone">{t.has(purposeKey as never) ? t(purposeKey as never) : row.purpose}</span>
                  </p>
                  <p className="text-small text-brand-stone">{formatISTDateTime(new Date(row.at), locale)}</p>
                </div>
                <span className={cn('shrink-0 rounded-full px-3 py-1 text-small font-semibold', TONE[row.status] ?? TONE['SENT'])}>
                  {t.has(statusKey as never) ? t(statusKey as never) : row.status}
                </span>
              </div>

              {row.bodyPreview === null ? null : (
                <p className="mt-3 rounded-input bg-brand-paper p-3 text-small whitespace-pre-line text-brand-ink">{row.bodyPreview}</p>
              )}

              {row.status === 'SIMULATED' ? <p className="mt-2 text-small font-semibold text-semantic-fee-due-soon">{t('demo')}</p> : null}
              {row.errorCode === null ? null : (
                <p className="mt-2 text-small font-semibold text-semantic-fee-expired">{reasonText(row.errorCode)}</p>
              )}
            </article>
          </li>
        );
      })}
    </ul>
  );
}
