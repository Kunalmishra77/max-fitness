import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { LoginForm } from '@/components/crm/login-form';
import { currentActor, signIn } from '@/lib/crm';

/**
 * `/crm/login` — mobile and PIN (crm-ux-blueprint §1; security-plan.md §3.1).
 *
 * The PIN is checked on the server by a server action, so it never travels to any
 * client-side code, and the session cookie is set in the same round trip.
 */

export const dynamic = 'force-dynamic';

export default async function CrmLoginPage() {
  if ((await currentActor()) !== null) redirect('/crm');
  const t = await getTranslations('crm.login');

  async function submit(values: { mobile: string; pin: string; trusted: boolean }) {
    'use server';
    const outcome = await signIn(values);
    if (outcome.ok) redirect('/crm');
    return outcome;
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <h1 className="font-display text-display-m font-bold text-brand-obsidian">{t('title')}</h1>
      <p className="mt-2 text-crm-body text-brand-stone">{t('subtitle')}</p>
      <LoginForm action={submit} />
    </main>
  );
}
