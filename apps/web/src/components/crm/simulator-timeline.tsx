'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { CrmIcon } from './crm-icons';

/**
 * The next thirty days, day by day (whatsapp-automation-engine §10).
 *
 * The owner's two questions are "is this too many messages?" and "what will they
 * actually say?" — so the month's total sits at the top, and every message opens
 * into the text the member would read on their phone, rendered from the same
 * template the send uses. A quiet day is labelled rather than left as a gap, because
 * a missing row looks like a bug.
 */

export interface SimulatorMessage {
  readonly id: string;
  readonly slot: string;
  readonly memberName: string;
  readonly ruleCode: string;
  /** The rendered template body, exactly as the member would receive it. */
  readonly preview: string;
}

export interface SimulatorDay {
  readonly date: string;
  readonly label: string;
  readonly weekday: string;
  readonly messages: readonly SimulatorMessage[];
  readonly skipped: number;
}

export function SimulatorTimeline({
  days,
  totalMessages,
  totalSkipped,
}: {
  readonly days: readonly SimulatorDay[];
  readonly totalMessages: number;
  readonly totalSkipped: number;
}) {
  const t = useTranslations('crm.simulator');
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <div className="grid gap-2 rounded-panel border border-brand-stone/15 bg-white p-4 shadow-sm">
        <p className="font-display text-[2rem] leading-none font-bold text-brand-obsidian tabular">{t('total', { count: totalMessages })}</p>
        <p className="text-small text-brand-stone">{t('caveat')}</p>
        {totalSkipped > 0 ? <p className="text-small font-semibold text-semantic-fee-due-soon">{t('heldBack', { count: totalSkipped })}</p> : null}
      </div>

      <ul className="grid gap-2 pb-24 lg:pb-0">
        {days.map((day) => (
          <li key={day.date} className="rounded-panel border border-brand-stone/15 bg-white p-4 shadow-sm">
            <div className="flex items-baseline gap-3">
              <span className="text-crm-body font-bold text-brand-obsidian">{day.label}</span>
              <span className="text-small text-brand-stone">{day.weekday}</span>
              <span className="ml-auto text-small font-semibold text-brand-stone tabular">
                {day.messages.length === 0 ? t('quiet') : t('count', { count: day.messages.length })}
              </span>
            </div>

            {day.messages.length === 0 ? null : (
              <ul className="mt-3 grid gap-2">
                {day.messages.map((message) => {
                  const isOpen = open === message.id;
                  return (
                    <li key={message.id}>
                      <button
                        type="button"
                        onClick={() => setOpen(isOpen ? null : message.id)}
                        aria-expanded={isOpen}
                        className={cn(
                          'flex w-full min-h-11 items-center gap-3 rounded-input px-3 py-2 text-left transition-colors',
                          isOpen ? 'bg-brand-obsidian text-brand-white' : 'bg-brand-paper hover:bg-brand-stone/10',
                        )}
                      >
                        <span className={cn('text-small font-semibold tabular', isOpen ? 'text-brand-mist' : 'text-brand-stone')}>{message.slot}</span>
                        <span className="min-w-0 flex-1 truncate text-crm-body font-semibold">{message.memberName}</span>
                        <span className={cn('text-small', isOpen ? 'text-brand-mist' : 'text-brand-stone')}>{message.ruleCode}</span>
                        <CrmIcon name="chevron" className={cn('size-4 shrink-0 transition-transform', isOpen && 'rotate-90')} />
                      </button>

                      {isOpen ? (
                        // A WhatsApp bubble, so the owner reads it the way the member will.
                        <div className="mt-2 ml-8 max-w-prose rounded-panel rounded-tl-sm bg-[#dcf8c6] p-3 text-small whitespace-pre-line text-brand-ink shadow-sm">
                          {message.preview}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {day.skipped > 0 ? <p className="mt-2 text-small text-semantic-fee-due-soon">{t('heldBack', { count: day.skipped })}</p> : null}
          </li>
        ))}
      </ul>
    </>
  );
}
