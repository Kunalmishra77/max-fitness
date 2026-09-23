'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CrmIcon } from './crm-icons';

/**
 * Today's birthdays, with the wish the desk sends by hand (BR-8.2).
 *
 * `autoBirthdayWish` is off on purpose, so this list is where a wish happens. It says
 * out loud why a member cannot be wished — no WhatsApp, or they unsubscribed — rather
 * than quietly leaving the button out, because "why is there no button" is a question
 * the desk would otherwise have to ask someone.
 */

export interface BirthdayItem {
  readonly memberId: string;
  readonly fullName: string;
  readonly memberCode: string | null;
  readonly canWish: boolean;
  readonly wished: boolean;
}

export type BirthdayWishResult = { ok: true } | { ok: false; code: string };

export function BirthdayList({
  items,
  canSend,
  onSend,
}: {
  readonly items: readonly BirthdayItem[];
  /** False for a trainer, who may read the list but not message anyone. */
  readonly canSend: boolean;
  readonly onSend: (memberId: string) => Promise<BirthdayWishResult>;
}) {
  const t = useTranslations('crm.home');
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (items.length === 0) {
    return <p className="mt-3 text-small text-brand-stone">{t('noBirthdays')}</p>;
  }

  const wish = (memberId: string) => {
    setFailed(null);
    startTransition(async () => {
      const result = await onSend(memberId);
      if (result.ok) setSent((done) => new Set([...done, memberId]));
      else setFailed(memberId);
    });
  };

  return (
    <>
      <ul className="mt-3 grid gap-2">
        {items.map((item) => {
          const done = item.wished || sent.has(item.memberId);
          return (
            <li key={item.memberId} className="flex flex-wrap items-center gap-2 rounded-input bg-brand-paper px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-crm-body font-semibold text-brand-obsidian">{item.fullName}</span>
              {done ? (
                <span className="inline-flex items-center gap-1 text-small font-semibold text-semantic-fee-paid">
                  <CrmIcon name="whatsapp" className="size-4" />
                  {t('wishSent')}
                </span>
              ) : !item.canWish ? (
                <span className="text-small text-brand-stone">{t('noWhatsApp')}</span>
              ) : canSend ? (
                <button
                  type="button"
                  onClick={() => wish(item.memberId)}
                  disabled={pending}
                  className="min-h-11 rounded-full bg-brand-accent px-4 text-small font-semibold text-brand-white disabled:opacity-60"
                >
                  {t('sendWish')}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {failed === null ? null : (
        <p role="alert" className="mt-2 text-small font-semibold text-semantic-fee-expired">
          {t('wishFailed')}
        </p>
      )}
    </>
  );
}
