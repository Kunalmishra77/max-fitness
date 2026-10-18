'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { formatISTDate, toISTDate } from '@mfp/shared';
import { cn } from '@/lib/cn';

/**
 * One member's thread (ADR-128).
 *
 * **This is not a chat.** Almost every message here was written by a rule, sent by a
 * machine, about money — so a bubble alone answers neither of reception's questions.
 * Under each of the gym's messages sits what sent it and what became of it: *"Fee
 * reminder · 11:04 · Read"*. That line is the screen's reason to exist; the bubble is
 * only how it reads naturally.
 *
 * The gym speaks in obsidian, the member in paper grey. One voice each, no colour games
 * — the fee colours are reserved for whether a message arrived.
 */

export interface ThreadMessage {
  readonly id: string;
  readonly direction: 'OUTBOUND' | 'INBOUND';
  readonly purpose: string;
  readonly status: string;
  readonly ruleCode: string | null;
  readonly bodyPreview: string | null;
  readonly errorCode: string | null;
  /** ISO instant. */
  readonly at: string;
}

/** How a send reads: green when it landed, red when it did not, grey while in flight. */
const STATUS_TONE: Record<string, string> = {
  READ: 'text-semantic-fee-paid',
  DELIVERED: 'text-semantic-fee-paid',
  SENT: 'text-brand-mist',
  QUEUED: 'text-brand-mist',
  SIMULATED: 'text-semantic-fee-due-soon',
  FAILED: 'text-semantic-fee-expired',
  SKIPPED: 'text-semantic-fee-expired',
};

const istDay = (iso: string) => toISTDate(new Date(iso));
const istTime = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(new Date(iso));

export function InboxThread({
  memberId,
  messages,
  windowMinutesLeft,
}: {
  readonly memberId: string;
  readonly messages: readonly ThreadMessage[];
  /** Minutes of free-text time left, or `null` when the window is shut (ADR-127). */
  readonly windowMinutesLeft: number | null;
}) {
  const t = useTranslations('crm.messages');
  const locale = useLocale();
  const router = useRouter();
  const [text, setText] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = () => {
    const body = text.trim();
    if (body === '') return;
    setFailure(null);
    start(async () => {
      try {
        const response = await fetch('/api/v1/crm/messages/reply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ memberId, text: body }),
        });
        if (!response.ok) {
          setFailure(t('sendFailed'));
          return;
        }
        setText('');
        // The row the server just wrote is the one that should appear; re-reading the
        // page is cheaper and more honest than guessing what it says.
        router.refresh();
      } catch {
        setFailure(t('sendFailed'));
      }
    });
  };

  let lastDay = '';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((message) => {
          const day = istDay(message.at);
          const newDay = day !== lastDay;
          lastDay = day;
          const outbound = message.direction === 'OUTBOUND';
          const purposeKey = `purpose.${message.purpose}`;
          const statusKey = `status.${message.status}`;
          const reasonKey = message.errorCode === null ? null : `reason.${message.errorCode}`;

          return (
            <li key={message.id}>
              {newDay ? (
                <p className="my-4 text-center">
                  <span className="rounded-full bg-brand-stone/10 px-3 py-1 text-small font-semibold text-brand-stone">
                    {formatISTDate(day, locale)}
                  </span>
                </p>
              ) : null}

              <div className={cn('flex', outbound ? 'justify-end' : 'justify-start')}>
                <div className="max-w-[min(32rem,85%)]">
                  <p
                    className={cn(
                      'rounded-2xl px-4 py-3 text-crm-body leading-body whitespace-pre-line',
                      outbound ? 'rounded-br-sm bg-brand-obsidian text-brand-white' : 'rounded-bl-sm bg-brand-paper text-brand-ink',
                    )}
                  >
                    {message.bodyPreview ?? t('noPreview')}
                  </p>

                  {/* Why it was sent and what became of it — the two things a bubble
                      cannot say and reception always needs. */}
                  <p className={cn('mt-1 flex flex-wrap items-center gap-x-2 text-small', outbound ? 'justify-end' : '')}>
                    {outbound ? (
                      <span className="text-brand-stone">{t.has(purposeKey as never) ? t(purposeKey as never) : message.purpose}</span>
                    ) : null}
                    <span className="tabular text-brand-stone">{istTime(message.at)}</span>
                    {outbound ? (
                      <span className={cn('font-semibold', STATUS_TONE[message.status] ?? 'text-brand-stone')}>
                        {t.has(statusKey as never) ? t(statusKey as never) : message.status}
                      </span>
                    ) : null}
                  </p>

                  {reasonKey === null ? null : (
                    <p className={cn('mt-1 text-small font-semibold text-semantic-fee-expired', outbound ? 'text-end' : '')}>
                      {t.has(reasonKey as never) ? t(reasonKey as never) : message.errorCode}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="border-t border-brand-stone/12 bg-white p-3">
        {windowMinutesLeft === null ? (
          /**
           * Shut, and said plainly. WhatsApp allows free text only for 24 hours after the
           * member writes; outside that the Graph API refuses it, the member sees nothing,
           * and reception is left reading an error code. Better to not offer the box.
           */
          <p className="rounded-input bg-brand-paper px-4 py-3 text-small leading-body text-brand-stone">{t('windowShut')}</p>
        ) : (
          <>
            <label className="block">
              <span className="sr-only">{t('replyPlaceholder')}</span>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) send();
                }}
                rows={2}
                maxLength={1000}
                placeholder={t('replyPlaceholder')}
                className="w-full resize-none rounded-input border border-brand-stone/25 bg-white px-4 py-3 text-crm-body text-brand-ink placeholder:text-brand-stone focus:border-brand-accent focus:outline-2 focus:outline-offset-2 focus:outline-semantic-focus-ring"
              />
            </label>
            <div className="mt-2 flex items-center gap-3">
              <p className="min-w-0 flex-1 text-small text-brand-stone">
                {t('windowOpen', { hours: Math.floor(windowMinutesLeft / 60), minutes: windowMinutesLeft % 60 })}
              </p>
              <button
                type="button"
                onClick={send}
                disabled={pending || text.trim() === ''}
                className="min-h-12 shrink-0 rounded-button bg-brand-accent px-6 text-crm-body font-semibold text-brand-white disabled:opacity-40"
              >
                {pending ? t('sending') : t('send')}
              </button>
            </div>
          </>
        )}

        {failure === null ? null : (
          <p role="alert" className="mt-2 text-small font-semibold text-semantic-fee-expired">
            {failure}
          </p>
        )}
      </div>
    </div>
  );
}
