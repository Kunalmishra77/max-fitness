'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { BotAskResult, BotConfigInput, BotDocumentInput, Language } from '@mfp/core';
import { CRM_CARD } from '@/components/crm/crm-chrome';
import { cn } from '@/lib/cn';
import type { SettingsResult } from '@/lib/settings-types';

/**
 * The assistant's console (ADR-090).
 *
 * Four things on one screen, in the order the owner needs them: the two switches, what it
 * knows, a place to try it, and what it has already been asked.
 *
 * The test chat is the part that earns the screen. It answers from exactly what a member
 * would get — same persona, same knowledge base, same escalation rule — so "it said something
 * odd" becomes a thing the owner can reproduce and fix by editing a document, rather than a
 * complaint nobody can act on.
 */

export type BotTestOutcome = { ok: true; result: BotAskResult } | { ok: false; code: 'FORBIDDEN' | 'generic' };

export interface BotDocumentRow {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly sourceName: string | null;
}

export interface BotReplyRow {
  readonly id: string;
  readonly question: string;
  readonly answer: string | null;
  readonly status: string;
  readonly reason: string | null;
  readonly isTest: boolean;
  readonly who: string;
  readonly at: string;
}

const FIELD = 'mt-1 min-h-14 w-full rounded-input border-2 border-brand-stone/40 bg-white px-4 text-crm-body text-brand-obsidian';

export function BotConsole({
  config,
  documents,
  replies,
  aiReady,
  saveConfig,
  saveDocument,
  deleteDocument,
  test,
}: {
  readonly config: BotConfigInput;
  readonly documents: readonly BotDocumentRow[];
  readonly replies: readonly BotReplyRow[];
  readonly aiReady: boolean;
  readonly saveConfig: (input: BotConfigInput) => Promise<SettingsResult>;
  readonly saveDocument: (input: BotDocumentInput) => Promise<SettingsResult>;
  readonly deleteDocument: (id: string) => Promise<SettingsResult>;
  readonly test: (question: string) => Promise<BotTestOutcome>;
}) {
  const t = useTranslations('crm.bot');
  const [draft, setDraft] = useState<BotConfigInput>(config);
  const [saved, setSaved] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; title: string; body: string } | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<BotAskResult | null>(null);
  const [pending, begin] = useTransition();

  const report = (result: SettingsResult, message: string) => {
    if (result.ok) {
      setSaved(message);
      setFailure(null);
      return true;
    }
    setFailure(t(`errors.${result.code}` as never));
    setSaved(null);
    return false;
  };

  const set = <K extends keyof BotConfigInput>(key: K, value: BotConfigInput[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const toggleLanguage = (language: Language) =>
    setDraft((current) => {
      const has = current.languages.includes(language);
      const next = has ? current.languages.filter((item) => item !== language) : [...current.languages, language];
      // Never none: a bot that serves no language cannot answer anybody.
      return { ...current, languages: next.length === 0 ? current.languages : next };
    });

  return (
    <div className="grid gap-3">
      {aiReady ? null : (
        <p role="status" className={cn(CRM_CARD, 'bg-tint-fee-due-soon-bg p-4 text-crm-body font-semibold text-semantic-fee-due-soon')}>
          {t('noKey')}
        </p>
      )}

      <section className={cn(CRM_CARD, 'p-4')} aria-labelledby="bot-switches">
        <h2 id="bot-switches" className="text-crm-body font-bold text-brand-obsidian">
          {t('switchesTitle')}
        </h2>
        <p className="mt-1 text-small text-brand-stone">{t('switchesHelp')}</p>

        <div className="mt-3 grid gap-3">
          {(
            [
              ['isActive', draft.isActive],
              ['autoReply', draft.autoReply],
            ] as ReadonlyArray<readonly ['isActive' | 'autoReply', boolean]>
          ).map(([key, value]) => (
            <label key={key} className="flex min-h-14 items-start gap-3">
              <input type="checkbox" checked={value} onChange={(event) => set(key, event.target.checked)} className="mt-1 size-6 shrink-0 accent-brand-accent" />
              <span>
                <span className="block text-crm-body font-semibold text-brand-obsidian">{t(`${key}Label`)}</span>
                <span className="block text-small text-brand-stone">{t(`${key}Help`)}</span>
              </span>
            </label>
          ))}

          <div>
            <label htmlFor="bot-name" className="block text-crm-body font-semibold text-brand-obsidian">
              {t('nameLabel')}
            </label>
            <input id="bot-name" value={draft.botName} onChange={(event) => set('botName', event.target.value)} className={FIELD} />
          </div>

          <div>
            <label htmlFor="bot-persona" className="block text-crm-body font-semibold text-brand-obsidian">
              {t('personaLabel')}
            </label>
            <textarea
              id="bot-persona"
              value={draft.persona}
              onChange={(event) => set('persona', event.target.value)}
              rows={4}
              className={cn(FIELD, 'min-h-28 py-3')}
            />
            <p className="mt-1 text-small text-brand-stone">{t('personaHelp')}</p>
          </div>

          <fieldset>
            <legend className="text-crm-body font-semibold text-brand-obsidian">{t('languagesLabel')}</legend>
            <div className="mt-2 flex gap-2">
              {(['hi', 'en'] as const).map((language) => (
                <label
                  key={language}
                  className={cn(
                    'flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-button border-2 text-crm-body font-semibold',
                    draft.languages.includes(language) ? 'border-brand-accent bg-brand-accent/[0.07]' : 'border-brand-stone/40 bg-white',
                  )}
                >
                  <input type="checkbox" checked={draft.languages.includes(language)} onChange={() => toggleLanguage(language)} className="sr-only" />
                  {t(`languages.${language}`)}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="bot-escalation" className="block text-crm-body font-semibold text-brand-obsidian">
              {t('escalationLabel')}
            </label>
            <input
              id="bot-escalation"
              value={draft.escalationNote ?? ''}
              onChange={(event) => set('escalationNote', event.target.value === '' ? null : event.target.value)}
              className={FIELD}
            />
            <p className="mt-1 text-small text-brand-stone">{t('escalationHelp')}</p>
          </div>
        </div>

        <button
          type="button"
          disabled={pending}
          onClick={() => begin(async () => void report(await saveConfig(draft), t('savedConfig')))}
          className="mt-4 min-h-16 w-full rounded-panel bg-brand-accent text-crm-body font-bold text-brand-white disabled:opacity-50"
        >
          {pending ? t('saving') : t('save')}
        </button>
      </section>

      <section className={cn(CRM_CARD, 'p-4')} aria-labelledby="bot-knowledge">
        <h2 id="bot-knowledge" className="text-crm-body font-bold text-brand-obsidian">
          {t('knowledgeTitle')}
        </h2>
        <p className="mt-1 text-small text-brand-stone">{t('knowledgeHelp')}</p>

        <ul className="mt-3 divide-y divide-brand-stone/15">
          {documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-crm-body font-semibold text-brand-obsidian">{document.title}</span>
                <span className="block truncate text-small text-brand-stone">{document.body.slice(0, 90)}</span>
              </span>
              <button
                type="button"
                onClick={() => setEditing({ id: document.id, title: document.title, body: document.body })}
                className="min-h-11 rounded-button border-2 border-brand-stone/40 px-3 text-small font-semibold text-brand-obsidian"
              >
                {t('edit')}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => begin(async () => void report(await deleteDocument(document.id), t('deleted')))}
                className="min-h-11 rounded-button border-2 border-semantic-fee-expired px-3 text-small font-semibold text-semantic-fee-expired disabled:opacity-50"
              >
                {t('delete')}
              </button>
            </li>
          ))}
          {documents.length === 0 ? <li className="py-4 text-crm-body text-brand-stone">{t('knowledgeEmpty')}</li> : null}
        </ul>

        {editing === null ? (
          <button
            type="button"
            onClick={() => setEditing({ id: null, title: '', body: '' })}
            className="mt-3 min-h-14 w-full rounded-panel border-2 border-brand-obsidian text-crm-body font-semibold text-brand-obsidian"
          >
            {t('addDocument')}
          </button>
        ) : (
          <div className="mt-3 grid gap-3 rounded-panel bg-brand-paper p-4">
            <div>
              <label htmlFor="doc-title" className="block text-crm-body font-semibold text-brand-obsidian">
                {t('docTitle')}
              </label>
              <input id="doc-title" value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} className={FIELD} />
            </div>
            <div>
              <label htmlFor="doc-body" className="block text-crm-body font-semibold text-brand-obsidian">
                {t('docBody')}
              </label>
              <textarea id="doc-body" value={editing.body} onChange={(event) => setEditing({ ...editing, body: event.target.value })} rows={8} className={cn(FIELD, 'min-h-44 py-3')} />
              <p className="mt-1 text-small text-brand-stone">{t('docBodyHelp')}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  begin(async () => {
                    const ok = report(await saveDocument({ id: editing.id, title: editing.title, body: editing.body, sourceName: null }), t('savedDocument'));
                    if (ok) setEditing(null);
                  })
                }
                className="min-h-14 rounded-panel bg-brand-accent text-crm-body font-bold text-brand-white disabled:opacity-50"
              >
                {t('saveDocument')}
              </button>
              <button type="button" onClick={() => setEditing(null)} className="min-h-14 rounded-panel border-2 border-brand-stone/40 text-crm-body font-semibold text-brand-obsidian">
                {t('cancel')}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className={cn(CRM_CARD, 'p-4')} aria-labelledby="bot-test">
        <h2 id="bot-test" className="text-crm-body font-bold text-brand-obsidian">
          {t('testTitle')}
        </h2>
        <p className="mt-1 text-small text-brand-stone">{t('testHelp')}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={t('testPlaceholder')}
            className={cn(FIELD, 'mt-0')}
          />
          <button
            type="button"
            disabled={pending || question.trim() === ''}
            onClick={() =>
              begin(async () => {
                const outcome = await test(question);
                if (outcome.ok) {
                  setAnswer(outcome.result);
                  setFailure(null);
                } else {
                  setFailure(t(`errors.${outcome.code}` as never));
                }
              })
            }
            className="min-h-14 rounded-panel bg-brand-obsidian px-6 text-crm-body font-bold text-brand-white disabled:opacity-50"
          >
            {pending ? t('asking') : t('askIt')}
          </button>
        </div>
        {answer === null ? null : (
          <p className={cn('mt-3 rounded-input p-3 text-crm-body', answer.outcome === 'ANSWER' ? 'bg-tint-fee-paid-bg text-brand-obsidian' : 'bg-tint-fee-due-soon-bg text-semantic-fee-due-soon')}>
            {answer.outcome === 'ANSWER' ? answer.text : answer.outcome === 'ESCALATE' ? t('wouldEscalate') : t('wouldSayNothing')}
          </p>
        )}
      </section>

      <section className={cn(CRM_CARD, 'overflow-hidden')} aria-labelledby="bot-log">
        <h2 id="bot-log" className="border-b border-brand-stone/15 px-4 py-3 text-crm-body font-bold text-brand-obsidian">
          {t('logTitle')}
        </h2>
        {replies.length === 0 ? (
          <p className="px-4 py-8 text-center text-crm-body text-brand-stone">{t('logEmpty')}</p>
        ) : (
          <ul>
            {replies.map((reply) => (
              <li key={reply.id} className="border-b border-brand-stone/15 px-4 py-3 last:border-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-small text-brand-stone">
                    {reply.who} · {reply.at}
                    {reply.isTest ? ` · ${t('testTag')}` : ''}
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-small font-semibold',
                      reply.status === 'ANSWERED'
                        ? 'bg-tint-fee-paid-bg text-semantic-fee-paid'
                        : reply.status === 'ESCALATED'
                          ? 'bg-tint-fee-due-soon-bg text-semantic-fee-due-soon'
                          : 'bg-tint-fee-expired-bg text-semantic-fee-expired',
                    )}
                  >
                    {t(`status.${reply.status}` as never)}
                    {reply.reason === null ? '' : ` · ${reply.reason}`}
                  </span>
                </div>
                <p className="mt-1 text-crm-body font-semibold text-brand-obsidian">{reply.question}</p>
                {reply.answer === null ? null : <p className="mt-1 text-crm-body text-brand-ink">{reply.answer}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {saved === null ? null : (
        <p role="status" className="rounded-input bg-tint-fee-paid-bg p-3 text-crm-body font-semibold text-semantic-fee-paid">
          {saved}
        </p>
      )}
      {failure === null ? null : (
        <p role="alert" className="rounded-input bg-tint-fee-expired-bg p-3 text-crm-body font-semibold text-semantic-fee-expired">
          {failure}
        </p>
      )}
    </div>
  );
}
