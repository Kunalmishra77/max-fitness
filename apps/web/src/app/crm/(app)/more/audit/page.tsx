import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { auditChanges, can, mayAfterPinEntry } from '@mfp/core';
import { formatISTDateTime, isISTDate } from '@mfp/shared';
import { unlockSettingsAction } from '@/app/crm/actions';
import { BottomNav, CrmHeader, CRM_CARD } from '@/components/crm/crm-chrome';
import { SettingsUnlock } from '@/components/crm/settings-forms';
import { cn } from '@/lib/cn';
import { getContainer } from '@/lib/container';
import { auditReader, requireCrmContext } from '@/lib/crm';

/**
 * The audit trail (CRM-AUDIT).
 *
 * `AuditLog` has been written to since the first migration — every voided payment, erased
 * member, PIN reset, price change and settings edit — and nothing in the CRM has ever read
 * it. The gym has been paying the cost of recording its own accountability trail without
 * being able to look at it.
 *
 * **Owner-only and behind the PIN.** Its own capability rather than `settings.manage`,
 * because this screen shows what the owner did as well as what staff did, and a permission
 * named "manage settings" should not decide who reads that. Elevated because it is the
 * whole history of every sensitive action in one place: a phone left unlocked on the
 * reception desk must not open it.
 *
 * **Read-only by construction.** There is no action on this page and no write side in the
 * repository. A screen that could amend the record of somebody amending the record would
 * defeat the object.
 *
 * **The before/after snapshots are never printed raw.** They are whole row snapshots, so
 * they carry mobile numbers, PIN hashes and storage keys; `auditChanges` reduces them to
 * which fields moved, with a name-based denylist masking anything sensitive. An audit
 * screen that leaks the data it audits would be worse than none, and the screen says so
 * at the bottom rather than leaving the owner wondering why a number is starred out.
 */

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

/**
 * The action codes `crm.audit.actions` has wording for.
 *
 * Kept beside the messages it mirrors. An action this list does not know is shown as its
 * raw code — which is the right failure for an audit trail: better a reader sees
 * `payment.refund` than nothing at all because somebody forgot a translation.
 */
const KNOWN_ACTIONS = new Set([
  'payment.void',
  'member.edit',
  'member.erase',
  'member.export',
  'member.import',
  'member.reminders',
  'member.unsubscribed',
  'verification.approve',
  'verification.reject',
  'settings.update',
  'reminders.update',
  'plans.price',
  'plans.active',
  'staff.add',
  'staff.pin',
  'staff.activate',
  'staff.deactivate',
  'bot.config',
  'bot.document',
  'create',
  'merge',
]);

export default async function CrmAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; action?: string; cursor?: string }>;
}) {
  const { actor, gym } = await requireCrmContext();
  const t = await getTranslations('crm');
  const { clock } = getContainer();
  const now = clock.now();
  const { from, to, action, cursor } = await searchParams;

  if (!mayAfterPinEntry(actor, 'audit.view', now)) {
    return (
      <>
        <CrmHeader title={t('audit.title')} back="/crm/more" />
        <p role="alert" className="m-4 rounded-panel bg-tint-fee-none-bg p-4 text-crm-body font-semibold text-brand-obsidian">
          {t('audit.ownerOnly')}
        </p>
        <BottomNav active="more" />
      </>
    );
  }

  if (!can(actor, 'audit.view', now)) {
    // Elevation is session-wide, so the existing unlock serves every elevated capability;
    // only its name is settings-specific.
    return (
      <>
        <CrmHeader title={t('audit.title')} subtitle={t('audit.subtitle')} back="/crm/more" />
        <SettingsUnlock unlock={unlockSettingsAction} />
        <BottomNav active="more" />
      </>
    );
  }

  const reader = auditReader();
  const [page, actions] = await Promise.all([
    reader.list(gym.id, {
      ...(isISTDate(from) ? { from } : {}),
      ...(isISTDate(to) ? { to } : {}),
      ...(action === undefined || action === '' ? {} : { action }),
      ...(cursor === undefined || cursor === '' ? {} : { cursor }),
      limit: PAGE_SIZE,
    }),
    reader.actions(gym.id),
  ]);

  const locale = actor.language === 'hi' ? 'hi-IN' : 'en-IN';

  /** Who acted. A staff name when there is one, and the honest alternative when not. */
  const actorLabel = (row: (typeof page.rows)[number]) => {
    if (row.actorName !== null) return t('audit.by', { name: row.actorName });
    if (row.actorType === 'system') return t('audit.bySystem');
    if (row.actorType === 'webhook') return t('audit.byWebhook');
    if (row.actorType === 'kiosk') return t('audit.byKiosk');
    if (row.actorType === 'member') return t('audit.byMember');
    return t('audit.byUnknown');
  };

  /**
   * The recorded action code, humanised where we have words for it.
   *
   * Checked against an explicit list rather than asking next-intl and inspecting what
   * comes back: a missing key makes it echo the whole dotted path, so an action added by
   * a later feature would read as `crm.audit.actions.something.new` on the owner's screen.
   * Falling back to the bare code is honest and still searchable.
   *
   * **The dot becomes an underscore.** An action code is `payment.void`, and next-intl
   * reads a dot as nesting — so a message keyed `"payment.void"` is not a key it will
   * accept, and it refuses the whole message file rather than that one entry. The file
   * loaded on every page of the site, so this took the application down in development
   * and nobody noticed, because the messages test only compares English against Hindi
   * and never asked next-intl whether it would load either of them.
   */
  const messageKey = (code: string) => code.replace(/\./g, '_');
  const actionLabel = (code: string) => (KNOWN_ACTIONS.has(code) ? t(`audit.actions.${messageKey(code)}` as never) : code);

  /** Keeps the filters on the paging link. */
  const linkWith = (extra: Record<string, string>) => {
    const params = new URLSearchParams();
    if (isISTDate(from)) params.set('from', from);
    if (isISTDate(to)) params.set('to', to);
    if (action !== undefined && action !== '') params.set('action', action);
    for (const [key, value] of Object.entries(extra)) params.set(key, value);
    const query = params.toString();
    return query === '' ? '/crm/more/audit' : `/crm/more/audit?${query}`;
  };

  return (
    <>
      <CrmHeader title={t('audit.title')} subtitle={t('audit.subtitle')} back="/crm/more" />

      {/* A plain GET form: the filters end up in the URL, so a view can be reloaded or
          sent, and the screen needs no JavaScript to work. */}
      <form method="get" action="/crm/more/audit" className={cn(CRM_CARD, 'flex flex-wrap items-end gap-3 px-4 py-4')}>
        <label className="flex flex-col gap-1 text-small font-semibold text-brand-stone">
          {t('audit.from')}
          <input type="date" name="from" defaultValue={isISTDate(from) ? from : ''} className="min-h-14 rounded-input border-2 border-brand-stone/40 bg-white px-3 text-crm-body text-brand-ink" />
        </label>
        <label className="flex flex-col gap-1 text-small font-semibold text-brand-stone">
          {t('audit.to')}
          <input type="date" name="to" defaultValue={isISTDate(to) ? to : ''} className="min-h-14 rounded-input border-2 border-brand-stone/40 bg-white px-3 text-crm-body text-brand-ink" />
        </label>
        <label className="flex flex-col gap-1 text-small font-semibold text-brand-stone">
          {t('audit.action')}
          {/* Only the actions this gym has actually recorded, so the list is never a
              catalogue of things that have never happened here. */}
          <select name="action" defaultValue={action ?? ''} className="min-h-14 rounded-input border-2 border-brand-stone/40 bg-white px-3 text-crm-body text-brand-ink">
            <option value="">{t('audit.allActions')}</option>
            {actions.map((code) => (
              <option key={code} value={code}>
                {actionLabel(code)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="min-h-14 rounded-button bg-brand-obsidian px-6 text-crm-body font-bold text-white">
          {t('audit.apply')}
        </button>
        {from === undefined && to === undefined && (action === undefined || action === '') ? null : (
          <Link href="/crm/more/audit" className="flex min-h-14 items-center text-crm-body font-semibold text-brand-link underline underline-offset-4">
            {t('audit.reset')}
          </Link>
        )}
      </form>

      {page.rows.length === 0 ? (
        <p className="px-4 py-12 text-center text-crm-body text-brand-stone">{t('audit.empty')}</p>
      ) : (
        <ul className="mt-3 grid gap-3">
          {page.rows.map((row) => {
            const changes = auditChanges(row.before, row.after);
            return (
              <li key={row.id} className={cn(CRM_CARD, 'px-4 py-4')}>
                <p className="text-crm-body font-bold text-brand-obsidian">{actionLabel(row.action)}</p>
                <p className="mt-0.5 text-small text-brand-stone">
                  {formatISTDateTime(row.createdAt, locale)} · {actorLabel(row)}
                </p>

                {changes.length === 0 ? (
                  <p className="mt-2 text-small text-brand-stone/80">{t('audit.noChanges')}</p>
                ) : (
                  <>
                    <p className="mt-2 text-small font-semibold text-brand-stone">{t('audit.changed', { count: changes.length })}</p>
                    <ul className="mt-1 grid gap-1">
                      {changes.map((change) => (
                        <li key={change.field} className="text-small text-brand-ink">
                          <span className="font-semibold">{change.field}</span>
                          {': '}
                          {/* An arrow rather than two labelled columns: it is read on a
                              phone, and "30 Sep → 31 Oct" needs no column headings. */}
                          <span className="text-brand-stone">{change.before ?? '—'}</span>
                          {' → '}
                          <span>{change.after ?? '—'}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {page.nextCursor === null ? null : (
        <div className="px-4 py-5">
          <Link
            href={linkWith({ cursor: page.nextCursor })}
            className="flex min-h-14 items-center justify-center rounded-button border-2 border-brand-obsidian px-6 text-crm-body font-bold text-brand-obsidian"
          >
            {t('audit.older')}
          </Link>
        </div>
      )}

      <p className="px-4 pb-4 text-small text-brand-stone/80">{t('audit.redactedNote')}</p>

      <BottomNav active="more" />
    </>
  );
}
