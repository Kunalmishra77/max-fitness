'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, useTransition, type ChangeEvent } from 'react';
import { MAX_IMPORT_BYTES, type ImportCommitResult, type ImportPreviewResult } from '@/lib/import-types';

/**
 * Import the paper register (crm-module-spec §7; ADR-056).
 *
 * Choose the file, see what it would do — members to add, members already here, each
 * line that needs fixing — and only then add them, with the PIN and the owner's word on
 * whether these members agreed to WhatsApp at the desk. Nothing is saved before that
 * last tap, and a file with a mistake in it offers no way to save at all.
 */

const FILE_ERRORS = new Set(['empty', 'missing_columns', 'too_many_rows', 'unreadable', 'too_large']);

type Preview = Extract<ImportPreviewResult, { ok: true }>;

export function ImportWizard({
  preview,
  commit,
}: {
  preview: (csv: string) => Promise<ImportPreviewResult>;
  commit: (csv: string, deskConsent: boolean, pin: string) => Promise<ImportCommitResult>;
}) {
  const t = useTranslations('crm.import');
  const id = useId();
  const [csv, setCsv] = useState<string | null>(null);
  const [checked, setChecked] = useState<Preview | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [deskConsent, setDeskConsent] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: number; skipped: number } | null>(null);
  const [checking, startCheck] = useTransition();
  const [saving, startSave] = useTransition();

  const reset = () => {
    setCsv(null);
    setChecked(null);
    setFileError(null);
    setError(null);
    setPin('');
    setDeskConsent(false);
    setDone(null);
  };

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = '';
    reset();
    if (picked === undefined) return;
    // Checked here too, so a huge file never leaves the phone.
    if (picked.size > MAX_IMPORT_BYTES) {
      setFileError(t('fileErrors.too_large'));
      return;
    }
    startCheck(async () => {
      const text = await picked.text();
      const answer = await preview(text);
      if (answer.ok) {
        setCsv(text);
        setChecked(answer);
      } else if (answer.code === 'missing_columns') {
        setFileError(t('fileErrors.missing_columns', { columns: (answer.missing ?? []).join(', ') }));
      } else if (FILE_ERRORS.has(answer.code)) {
        setFileError(t(`fileErrors.${answer.code}` as never));
      } else {
        setFileError(answer.code === 'FORBIDDEN' ? t('notAllowed') : t('failed'));
      }
    });
  };

  const add = () => {
    if (csv === null) return;
    setError(null);
    startSave(async () => {
      const result = await commit(csv, deskConsent, pin);
      setPin('');
      if (result.ok) {
        setDone({ created: result.created, skipped: result.skipped });
        return;
      }
      setError(
        result.code === 'INVALID_PIN'
          ? t('wrongPin')
          : result.code === 'ACCOUNT_LOCKED'
            ? t('locked')
            : result.code === 'FORBIDDEN'
              ? t('notAllowed')
              : result.code === 'ROWS_WRONG' || result.code === 'FILE'
                ? t('rowsWrong')
                : t('failed'),
      );
    });
  };

  const field = 'mt-1 min-h-14 w-full rounded-input border-2 border-brand-rubber-grey/40 bg-white px-4 text-crm-body';

  if (done !== null) {
    return (
      <div className="grid gap-4 p-6 text-center">
        <p aria-hidden className="text-6xl">
          ✅
        </p>
        <h2 className="font-display text-display-m font-bold text-brand-plate-navy">{t('done', { count: done.created })}</h2>
        {done.skipped > 0 ? <p className="text-crm-body text-brand-rubber-grey">{t('doneSkipped', { count: done.skipped })}</p> : null}
        <a href="/crm/members" className="flex min-h-16 items-center justify-center rounded-panel bg-brand-signboard-red text-crm-body font-bold text-white">
          {t('toMembers')}
        </a>
        <button type="button" onClick={reset} className="min-h-14 text-crm-body font-semibold text-brand-rubber-grey">
          {t('another')}
        </button>
      </div>
    );
  }

  const summary = checked?.summary;

  return (
    <div className="grid gap-4 p-4 pb-24">
      <p className="text-crm-body text-brand-rubber-grey">{t('helper')}</p>
      <a
        href="/crm/import/template"
        download
        className="flex min-h-14 items-center justify-center rounded-panel border-2 border-brand-plate-navy text-crm-body font-semibold text-brand-plate-navy"
      >
        {t('template')}
      </a>

      <div>
        <label htmlFor={`${id}-file`} className="block text-crm-body font-semibold">
          {t('file')}
        </label>
        <input
          id={`${id}-file`}
          type="file"
          accept=".csv,text/csv"
          onChange={choose}
          className="mt-1 block min-h-14 w-full rounded-input border-2 border-dashed border-brand-rubber-grey/40 bg-white p-3 text-crm-body"
        />
      </div>

      {checking ? (
        <p role="status" className="text-crm-body">
          {t('checking')}
        </p>
      ) : null}
      {fileError === null ? null : (
        <p role="alert" className="rounded-input bg-tint-fee-expired-bg p-3 text-crm-body font-medium text-semantic-fee-expired">
          {fileError}
        </p>
      )}

      {checked === null || summary === undefined ? null : (
        <section aria-labelledby={`${id}-result`} className="grid gap-3">
          <h2 id={`${id}-result`} className="sr-only">
            {t('file')}
          </h2>
          <ul className="grid gap-2 min-[480px]:grid-cols-3">
            <li className="rounded-panel bg-tint-fee-paid-bg p-3 text-crm-body font-semibold text-semantic-fee-paid">{t('summary.ready', { count: summary.ready })}</li>
            <li className="rounded-panel bg-tint-fee-none-bg p-3 text-crm-body font-semibold text-brand-plate-navy">{t('summary.skipped', { count: summary.skipped })}</li>
            {summary.withErrors > 0 ? (
              <li className="rounded-panel bg-tint-fee-expired-bg p-3 text-crm-body font-semibold text-semantic-fee-expired">
                {t('summary.withErrors', { count: summary.withErrors })}
              </li>
            ) : null}
          </ul>

          {checked.problems.length === 0 ? null : (
            <div className="rounded-panel bg-white p-3">
              <h3 className="text-crm-body font-bold text-brand-plate-navy">{t('problemsTitle')}</h3>
              <ul className="mt-2 divide-y divide-brand-rubber-grey/15">
                {checked.problems.map((problem) => (
                  <li key={problem.line} className="grid gap-1 py-2">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-crm-body font-semibold">{t('line', { line: problem.line })}</span>
                      {problem.name === null ? null : <span className="text-small text-brand-rubber-grey">{problem.name}</span>}
                    </span>
                    {problem.errors.length === 0 ? null : (
                      <span className="text-crm-body font-medium text-semantic-fee-expired">{problem.errors.map((code) => t(`fields.${code}` as never)).join(', ')}</span>
                    )}
                    {problem.warnings.map((code) => (
                      <span key={code} className="text-small font-medium text-brand-plate-navy">
                        {t(`warnings.${code}` as never)}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
              {checked.hiddenProblems > 0 ? <p className="mt-2 text-small text-brand-rubber-grey">{t('moreProblems', { count: checked.hiddenProblems })}</p> : null}
            </div>
          )}

          {summary.withErrors > 0 ? (
            <p className="rounded-input bg-tint-fee-expired-bg p-3 text-crm-body font-semibold text-semantic-fee-expired">{t('fixFirst')}</p>
          ) : summary.ready === 0 ? (
            <p className="rounded-input bg-tint-fee-none-bg p-3 text-crm-body font-semibold text-brand-plate-navy">{t('nothingNew')}</p>
          ) : (
            <div className="grid gap-3 rounded-panel bg-white p-4">
              <label className="flex min-h-14 items-start gap-3 text-crm-body">
                <input type="checkbox" checked={deskConsent} onChange={(event) => setDeskConsent(event.target.checked)} className="mt-1 size-6 accent-brand-plate-navy" />
                <span>{t('deskConsent')}</span>
              </label>
              <p className="-mt-2 text-small text-brand-rubber-grey">{t('deskConsentHelper')}</p>
              <div>
                <label htmlFor={`${id}-pin`} className="block text-crm-body font-semibold">
                  {t('pin')}
                </label>
                <input
                  id={`${id}-pin`}
                  type="password"
                  inputMode="numeric"
                  autoComplete="current-password"
                  maxLength={6}
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
                  className={`${field} text-center text-2xl tracking-widest`}
                />
              </div>
              {error === null ? null : (
                <p role="alert" className="rounded-input bg-tint-fee-expired-bg p-3 text-crm-body font-medium text-semantic-fee-expired">
                  {error}
                </p>
              )}
              <button
                type="button"
                disabled={saving || pin.length < 4}
                onClick={add}
                className="min-h-16 w-full rounded-panel bg-brand-signboard-red text-crm-body font-bold text-white disabled:opacity-50"
              >
                {saving ? t('committing') : t('commit', { count: summary.ready })}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
