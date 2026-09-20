'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';
import { PinGate } from '@/components/crm/settings-forms';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { SettingsPatchInput, SettingsResult, StaffCreateFields, StaffResult, UnlockResult } from '@/lib/settings-types';

/**
 * Who logs in at this gym (crm-ux-blueprint §14; ADR-048).
 *
 * The owner adds reception and trainers with their own PINs, changes a forgotten PIN,
 * and switches off someone who has left — each of the last two signs that person out of
 * every phone at once. Switching someone off asks once more, in words, because it is the
 * one tap here that locks a person out. An owner's own row has no buttons: an owner is
 * not reset or switched off from this screen.
 */

export interface StaffRow {
  readonly id: string;
  readonly name: string;
  readonly mobile: string;
  readonly role: string;
  readonly isActive: boolean;
  readonly lastLogin: string | null;
  readonly isYou: boolean;
}

type Unlock = (pin: string) => Promise<UnlockResult>;
type AnyResult = StaffResult | SettingsResult;

const field = 'min-h-14 w-full rounded-input border-2 border-brand-stone/40 bg-white px-4 text-crm-body';
const OWNER_ROLES = new Set(['OWNER', 'SUPER_ADMIN']);

/** Runs an owner action, asking for the PIN in place if it lapsed, then trying again. */
function useOwnerAction() {
  const t = useTranslations('crm.staff');
  const router = useRouter();
  const [status, setStatus] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const [pending, start] = useTransition();

  const run = (action: () => Promise<AnyResult>, success: string, onSuccess?: () => void) => {
    setStatus(null);
    start(async () => {
      const result = await action();
      if (result.ok) {
        setStatus({ text: success, tone: 'ok' });
        onSuccess?.();
        router.refresh();
        return;
      }
      if (result.code === 'PIN_REQUIRED') {
        setRetry(() => () => run(action, success, onSuccess));
        return;
      }
      const errorKey = result.code === 'CONFLICT' ? 'taken' : result.code === 'VALIDATION_FAILED' ? (('field' in result ? result.field : undefined) ?? 'generic') : 'generic';
      setStatus({ text: t(`errors.${errorKey}` as never), tone: 'error' });
    });
  };

  return { run, status, pending, retry, clearRetry: () => setRetry(null) };
}

function Status({ status }: { status: { text: string; tone: 'ok' | 'error' } | null }) {
  if (status === null) return null;
  return (
    <p role="status" className={`mt-2 text-crm-body font-medium ${status.tone === 'ok' ? 'text-semantic-fee-paid' : 'text-semantic-fee-expired'}`}>
      {status.text}
    </p>
  );
}

// ── Reception may take fees ─────────────────────────────────────────────────

export function ReceptionFeesToggle({ enabled, save, unlock }: { enabled: boolean; save: (patch: SettingsPatchInput) => Promise<SettingsResult>; unlock: Unlock }) {
  const t = useTranslations('crm.staff');
  const tSettings = useTranslations('crm.settings');
  const [on, setOn] = useState(enabled);
  const action = useOwnerAction();

  return (
    <section aria-label={t('receptionFees')} className="rounded-panel bg-white p-4 shadow-sm">
      <label className="flex min-h-11 items-start gap-3 text-crm-body">
        <input
          type="checkbox"
          checked={on}
          disabled={action.pending}
          onChange={(event) => {
            const next = event.target.checked;
            setOn(next);
            action.run(() => save({ pricing: { receptionMayTakePayments: next } }), tSettings('saved'));
          }}
          className="mt-1 size-6 accent-brand-obsidian"
        />
        <span>
          <span className="block font-semibold">{t('receptionFees')}</span>
          <span className="block text-small text-brand-stone">{t('receptionFeesHelper')}</span>
        </span>
      </label>
      {action.retry === null ? null : (
        <PinGate
          compact
          unlock={unlock}
          onUnlocked={() => {
            const again = action.retry;
            action.clearRetry();
            again?.();
          }}
        />
      )}
      <Status status={action.status} />
    </section>
  );
}

// ── The list ────────────────────────────────────────────────────────────────

export function StaffList({
  rows,
  resetPin,
  setActive,
  unlock,
}: {
  rows: readonly StaffRow[];
  resetPin: (staffUserId: string, pin: string) => Promise<StaffResult>;
  setActive: (staffUserId: string, active: boolean) => Promise<StaffResult>;
  unlock: Unlock;
}) {
  const t = useTranslations('crm.staff');
  return (
    <section aria-labelledby="staff-list-title" className="rounded-panel bg-white p-4 shadow-sm">
      <h2 id="staff-list-title" className="text-crm-body font-bold text-brand-obsidian">
        {t('title')}
      </h2>
      <p className="text-small text-brand-stone">{t('helper')}</p>
      <ul className="mt-3 divide-y divide-brand-stone/15">
        {rows.map((row) => (
          <StaffRowItem key={row.id} row={row} resetPin={resetPin} setActive={setActive} unlock={unlock} />
        ))}
      </ul>
    </section>
  );
}

function StaffRowItem({
  row,
  resetPin,
  setActive,
  unlock,
}: {
  row: StaffRow;
  resetPin: (staffUserId: string, pin: string) => Promise<StaffResult>;
  setActive: (staffUserId: string, active: boolean) => Promise<StaffResult>;
  unlock: Unlock;
}) {
  const t = useTranslations('crm.staff');
  const id = useId();
  const [mode, setMode] = useState<'idle' | 'pin' | 'confirm'>('idle');
  const [pin, setPin] = useState('');
  const action = useOwnerAction();
  const manageable = !row.isYou && !OWNER_ROLES.has(row.role);

  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0">
          <span className={`block truncate text-crm-body font-semibold ${row.isActive ? 'text-brand-ink' : 'text-brand-stone line-through'}`}>
            {row.name}
            {row.isYou ? ` (${t('you')})` : ''}
          </span>
          <span className="block text-small text-brand-stone">
            {row.mobile} · {row.lastLogin === null ? t('neverLoggedIn') : t('lastLogin', { date: row.lastLogin })}
          </span>
        </span>
        <span className="shrink-0 text-right text-small font-semibold">
          <span className="block text-brand-obsidian">{t(row.role as never)}</span>
          <span className={`block ${row.isActive ? 'text-semantic-fee-paid' : 'text-brand-stone'}`}>{row.isActive ? t('active') : t('inactive')}</span>
        </span>
      </div>

      {manageable && mode === 'idle' ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {row.isActive ? (
            <>
              <button type="button" onClick={() => setMode('pin')} className="min-h-11 rounded-button border-2 border-brand-obsidian px-3 text-small font-semibold text-brand-obsidian">
                {t('resetPin')}
              </button>
              <button type="button" onClick={() => setMode('confirm')} className="min-h-11 rounded-button border-2 border-semantic-fee-expired px-3 text-small font-semibold text-semantic-fee-expired">
                {t('deactivate')}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={action.pending}
              onClick={() => action.run(() => setActive(row.id, true), t('activated'))}
              className="min-h-11 rounded-button border-2 border-brand-obsidian px-3 text-small font-semibold text-brand-obsidian"
            >
              {t('activate')}
            </button>
          )}
        </div>
      ) : null}

      {mode === 'pin' ? (
        <div className="mt-2 grid gap-2 rounded-panel bg-tint-fee-none-bg p-3">
          <label htmlFor={`${id}-pin`} className="text-small font-semibold">
            {t('newPin')}
          </label>
          <input
            id={`${id}-pin`}
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
            className={`${field} text-center text-2xl tracking-widest`}
          />
          <p className="text-small text-brand-stone">{t('pinHelper')}</p>
          <button
            type="button"
            disabled={action.pending || pin.length < 4}
            onClick={() =>
              action.run(
                () => resetPin(row.id, pin),
                t('resetDone'),
                () => {
                  setPin('');
                  setMode('idle');
                },
              )
            }
            className="min-h-14 rounded-panel bg-brand-obsidian text-crm-body font-bold text-white disabled:opacity-50"
          >
            {action.pending ? t('saving') : t('resetSave')}
          </button>
          <button type="button" onClick={() => setMode('idle')} className="min-h-11 text-crm-body font-semibold text-brand-stone">
            {t('cancel')}
          </button>
        </div>
      ) : null}

      {mode === 'confirm' ? (
        <div role="group" aria-label={t('deactivate')} className="mt-2 grid gap-2 rounded-panel bg-tint-fee-expired-bg p-3">
          <p className="text-crm-body font-semibold text-semantic-fee-expired">{t('confirmDeactivate', { name: row.name })}</p>
          <button
            type="button"
            disabled={action.pending}
            onClick={() => action.run(() => setActive(row.id, false), t('deactivated'), () => setMode('idle'))}
            className="min-h-14 rounded-panel bg-semantic-fee-expired text-crm-body font-bold text-white disabled:opacity-50"
          >
            {t('yes')}
          </button>
          <button type="button" onClick={() => setMode('idle')} className="min-h-11 text-crm-body font-semibold text-brand-stone">
            {t('cancel')}
          </button>
        </div>
      ) : null}

      {action.retry === null ? null : (
        <PinGate
          compact
          unlock={unlock}
          onUnlocked={() => {
            const again = action.retry;
            action.clearRetry();
            again?.();
          }}
        />
      )}
      <Status status={action.status} />
    </li>
  );
}

// ── Add ─────────────────────────────────────────────────────────────────────

export function AddStaffForm({ add, unlock }: { add: (fields: StaffCreateFields) => Promise<StaffResult>; unlock: Unlock }) {
  const t = useTranslations('crm.staff');
  const id = useId();
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [role, setRole] = useState<'RECEPTION' | 'TRAINER'>('RECEPTION');
  const [pin, setPin] = useState('');
  const action = useOwnerAction();

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-panel bg-white p-4 shadow-sm">
      <h2 id={`${id}-title`} className="text-crm-body font-bold text-brand-obsidian">
        {t('add')}
      </h2>
      <div className="mt-3 grid gap-3">
        <div>
          <label htmlFor={`${id}-name`} className="block text-small font-semibold">
            {t('name')}
          </label>
          <input id={`${id}-name`} type="text" autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} className={`${field} mt-1`} />
        </div>
        <div>
          <label htmlFor={`${id}-mobile`} className="block text-small font-semibold">
            {t('mobile')}
          </label>
          <input id={`${id}-mobile`} type="tel" inputMode="numeric" maxLength={14} value={mobile} onChange={(event) => setMobile(event.target.value)} className={`${field} mt-1`} />
        </div>
        <div role="radiogroup" aria-label={t('role')} className="grid grid-cols-2 gap-2">
          {(['RECEPTION', 'TRAINER'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={role === value}
              onClick={() => setRole(value)}
              className={`min-h-14 rounded-panel border-2 text-crm-body font-semibold ${role === value ? 'border-brand-accent bg-tint-fee-expired-bg text-brand-accent' : 'border-brand-stone/40 bg-white'}`}
            >
              {t(value)}
            </button>
          ))}
        </div>
        <div>
          <label htmlFor={`${id}-pin`} className="block text-small font-semibold">
            {t('pin')}
          </label>
          <input
            id={`${id}-pin`}
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
            className={`${field} mt-1 text-center text-2xl tracking-widest`}
          />
          <p className="mt-1 text-small text-brand-stone">{t('pinHelper')}</p>
        </div>
      </div>

      {action.retry === null ? null : (
        <PinGate
          compact
          unlock={unlock}
          onUnlocked={() => {
            const again = action.retry;
            action.clearRetry();
            again?.();
          }}
        />
      )}
      <Status status={action.status} />
      <button
        type="button"
        disabled={action.pending || name.trim().length < 2 || mobile.replace(/\D/g, '').length < 10 || pin.length < 4}
        onClick={() =>
          action.run(
            () => add({ name: name.trim(), mobile, role, pin }),
            t('added', { name: name.trim() }),
            () => {
              setName('');
              setMobile('');
              setPin('');
            },
          )
        }
        className={cn(buttonVariants({ variant: 'primary', size: 'crmPrimary', full: true }), 'mt-3')}
      >
        {action.pending ? t('saving') : t('addSave')}
      </button>
    </section>
  );
}
