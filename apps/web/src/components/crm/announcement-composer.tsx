'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, useTransition } from 'react';
import { ANNOUNCEMENT_MAX_CHARS } from '@mfp/core';
import type { UnlockResult } from '@/lib/settings-types';
import { PinGate } from './settings-forms';

/**
 * The owner writes one message for every member — "kal gym band rahega" (ADR-079).
 *
 * The screen tells the truth before it does anything: how many members will get it, and
 * how many will not because they never agreed to WhatsApp or have unsubscribed. Then it
 * asks once more, because this is the only button in the product that reaches two hundred
 * phones and there is no taking it back.
 *
 * Paragraphs become one line on the way out — a WhatsApp template variable cannot hold a
 * newline — and the preview shows exactly what will arrive.
 */

export type AnnouncementAudienceChoice = 'ACTIVE' | 'EVERYONE';

export interface AnnouncementInput {
  readonly textEn: string;
  readonly textHi: string;
  readonly audience: AnnouncementAudienceChoice;
}

export type AnnouncementActionResult =
  | { readonly ok: true; readonly queued: number; readonly skipped: { readonly noOptIn: number; readonly unsubscribed: number; readonly noMobile: number } }
  | { readonly ok: false; readonly code: 'QUIET_HOURS'; readonly start: string; readonly end: string }
  | { readonly ok: false; readonly code: 'PAUSED' | 'NOBODY' | 'PIN_REQUIRED' | 'FORBIDDEN' | 'VALIDATION_FAILED' | 'generic' };

type Send = (input: AnnouncementInput) => Promise<AnnouncementActionResult>;
type Unlock = (pin: string) => Promise<UnlockResult>;

const box = 'min-h-32 w-full rounded-input border-2 border-brand-stone/40 bg-white p-4 text-crm-body';

/** What a member will actually read: one line, trimmed. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

export function AnnouncementComposer({
  reach,
  send,
  unlock,
}: {
  reach: { readonly reachable: number; readonly total: number };
  send: Send;
  unlock: Unlock;
}) {
  const t = useTranslations('crm.announce');
  const router = useRouter();
  const id = useId();
  const [textHi, setTextHi] = useState('');
  const [textEn, setTextEn] = useState('');
  const [audience, setAudience] = useState<AnnouncementAudienceChoice>('ACTIVE');
  const [stage, setStage] = useState<'writing' | 'confirming' | 'pin'>('writing');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ queued: number; skipped: { noOptIn: number; unsubscribed: number; noMobile: number } } | null>(null);
  const [pending, start] = useTransition();
  // A second tap while the first is in flight must not become a second announcement.
  const inFlight = useRef(false);

  const input = (): AnnouncementInput => ({ textEn: oneLine(textEn), textHi: oneLine(textHi), audience });

  const explain = (result: Extract<AnnouncementActionResult, { ok: false }>): string => {
    if (result.code === 'QUIET_HOURS') return t('errors.quietHours', { start: result.start, end: result.end });
    if (result.code === 'PAUSED') return t('errors.paused');
    if (result.code === 'NOBODY') return t('errors.nobody');
    if (result.code === 'FORBIDDEN') return t('errors.notAllowed');
    if (result.code === 'VALIDATION_FAILED') return t('errors.text');
    return t('errors.failed');
  };

  const run = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    start(async () => {
      try {
        const result = await send(input());
        if (result.ok) {
          setSent({ queued: result.queued, skipped: result.skipped });
          setStage('writing');
          setTextHi('');
          setTextEn('');
          router.refresh();
          return;
        }
        if (result.code === 'PIN_REQUIRED') {
          // The words are kept; the PIN is asked for and the same announcement retried.
          setStage('pin');
          return;
        }
        setStage('writing');
        setError(explain(result));
      } finally {
        inFlight.current = false;
      }
    });
  };

  const begin = () => {
    setSent(null);
    if (oneLine(textHi) === '' && oneLine(textEn) === '') {
      setError(t('errors.text'));
      return;
    }
    setError(null);
    setStage('confirming');
  };

  const preview = oneLine(textHi) !== '' ? oneLine(textHi) : oneLine(textEn);

  return (
    <div className="grid gap-4 p-4 pb-24">
      <section className="rounded-panel bg-white p-4 shadow-sm">
        <p className="text-crm-body font-bold text-brand-obsidian">{t('reachTitle')}</p>
        <p className="mt-1 text-crm-body">{t('reach', { reachable: reach.reachable, total: reach.total })}</p>
        {reach.total > reach.reachable ? <p className="mt-1 text-small text-brand-stone">{t('reachWhy', { count: reach.total - reach.reachable })}</p> : null}
      </section>

      {sent === null ? null : (
        <p role="status" className="rounded-panel bg-tint-fee-paid-bg p-4 text-crm-body font-semibold text-semantic-fee-paid">
          {t('sent', { count: sent.queued })}
          {sent.skipped.noOptIn + sent.skipped.unsubscribed + sent.skipped.noMobile > 0
            ? ` ${t('sentSkipped', { count: sent.skipped.noOptIn + sent.skipped.unsubscribed + sent.skipped.noMobile })}`
            : ''}
        </p>
      )}

      {stage === 'pin' ? (
        <div className="rounded-panel bg-white shadow-sm">
          <PinGate unlock={unlock} onUnlocked={run} title={t('pinAgain')} compact />
        </div>
      ) : null}

      <section className="rounded-panel bg-white p-4 shadow-sm">
        <label htmlFor={`${id}-hi`} className="block text-crm-body font-bold text-brand-obsidian">
          {t('hindi')}
        </label>
        <textarea
          id={`${id}-hi`}
          value={textHi}
          maxLength={ANNOUNCEMENT_MAX_CHARS}
          onChange={(event) => setTextHi(event.target.value)}
          className={`${box} mt-1`}
        />
        <label htmlFor={`${id}-en`} className="mt-4 block text-crm-body font-bold text-brand-obsidian">
          {t('english')}
        </label>
        <textarea
          id={`${id}-en`}
          value={textEn}
          maxLength={ANNOUNCEMENT_MAX_CHARS}
          onChange={(event) => setTextEn(event.target.value)}
          className={`${box} mt-1`}
        />
        <p className="mt-1 text-small text-brand-stone">{t('oneLanguageIsEnough')}</p>

        <fieldset className="mt-4">
          <legend className="text-crm-body font-bold text-brand-obsidian">{t('whoTitle')}</legend>
          {(['ACTIVE', 'EVERYONE'] as const).map((value) => (
            <label key={value} className="mt-2 flex min-h-14 items-center gap-3 text-crm-body">
              <input
                type="radio"
                name={`${id}-audience`}
                checked={audience === value}
                onChange={() => setAudience(value)}
                className="size-5 accent-brand-accent"
              />
              {t(`who.${value}` as never)}
            </label>
          ))}
        </fieldset>

        {preview === '' ? null : (
          <div className="mt-4 rounded-panel bg-tint-fee-none-bg p-4">
            <p className="text-small font-semibold text-brand-stone">{t('previewTitle')}</p>
            <p className="mt-1 text-crm-body">{t('previewBody', { message: preview })}</p>
          </div>
        )}

        {error === null ? null : (
          <p role="alert" className="mt-3 rounded-input bg-tint-fee-expired-bg p-3 text-crm-body font-medium text-semantic-fee-expired">
            {error}
          </p>
        )}

        {stage === 'confirming' ? (
          <div className="mt-4 rounded-panel border-2 border-brand-obsidian p-4">
            <p className="text-crm-body font-bold text-brand-obsidian">{t('confirmTitle', { count: reach.reachable })}</p>
            <p className="mt-1 text-small text-brand-stone">{t('confirmHelper')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={run}
                className="min-h-14 flex-1 rounded-panel bg-brand-accent px-4 text-crm-body font-bold text-white disabled:opacity-50"
              >
                {pending ? t('sending') : t('confirmSend')}
              </button>
              <button type="button" onClick={() => setStage('writing')} className="min-h-14 rounded-panel px-4 text-crm-body font-bold text-brand-stone">
                {t('cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={begin}
            className="mt-4 min-h-14 w-full rounded-panel bg-brand-obsidian text-crm-body font-bold text-white disabled:opacity-50"
          >
            {t('send')}
          </button>
        )}
      </section>
    </div>
  );
}
