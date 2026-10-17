import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

/**
 * Max Register's 404 (U-1 / Phase 8).
 *
 * Three CRM screens call `notFound()` — the member profile, its edit form and its renew
 * form — and the commonest way to see one is the honest one: reception had a member open,
 * the owner erased them, and the phone still has the URL. So the copy says the record may
 * have been removed and offers the two screens that actually help, rather than "404".
 *
 * Outside `(app)`, so it carries no sidebar or bottom bar: those are built from an actor,
 * and this must render even when the reason for landing here is that the session went.
 */

export const metadata = { robots: { index: false, follow: false } };

export default async function CrmNotFound() {
  const t = await getTranslations('errors.crmNotFound');

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-display-m font-bold text-brand-obsidian">{t('title')}</h1>
      <p className="max-w-[46ch] text-crm-body text-brand-stone">{t('body')}</p>
      <div className="mt-2 grid w-full max-w-xs gap-3">
        <Link href="/crm" className="flex min-h-14 items-center justify-center rounded-button bg-brand-obsidian text-crm-body font-bold text-white">
          {t('home')}
        </Link>
        <Link href="/crm/members" className="flex min-h-14 items-center justify-center rounded-button border-2 border-brand-obsidian text-crm-body font-bold text-brand-obsidian">
          {t('members')}
        </Link>
      </div>
    </main>
  );
}
