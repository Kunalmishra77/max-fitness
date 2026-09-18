import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { setLoginLanguageAction } from '@/app/crm/actions';
import { LanguageSwitch } from '@/components/crm/language-switch';
import { LoginForm } from '@/components/crm/login-form';
import { currentActor, signIn } from '@/lib/crm';

/**
 * `/crm/login` — mobile and PIN (crm-ux-blueprint §1; security-plan.md §3.1; ADR-062).
 *
 * The PIN is checked on the server by a server action, so it never travels to any
 * client-side code, and the session cookie is set in the same round trip. On a computer
 * the gym's photo and logo fill the left half; on a phone the logo sits above the form.
 */

export const dynamic = 'force-dynamic';

export default async function CrmLoginPage() {
  if ((await currentActor()) !== null) redirect('/crm');
  const t = await getTranslations('crm');
  const locale = (await getLocale()) === 'en' ? 'en' : 'hi';

  async function submit(values: { mobile: string; pin: string; trusted: boolean }) {
    'use server';
    const outcome = await signIn(values);
    if (outcome.ok) redirect('/crm');
    return outcome;
  }

  return (
    <main className="grid min-h-dvh bg-brand-obsidian lg:grid-cols-2">
      <section aria-hidden className="relative hidden overflow-hidden lg:block">
        <picture>
          <source type="image/avif" srcSet="/media/hero/hero2-poster.avif" />
          <img src="/media/hero/hero2-poster.webp" alt="" className="absolute inset-0 size-full object-cover" />
        </picture>
        <div className="absolute inset-0 bg-[linear-gradient(160deg,rgb(10_10_11/0.35),rgb(10_10_11/0.92)_75%)]" />
        <div className="relative flex h-full flex-col justify-end p-12 text-brand-white">
          <img src="/brand/logo-192.webp" alt="" width={198} height={192} className="w-28" />
          <p className="mt-6 font-display text-display-l leading-display font-bold tracking-[0.01em] uppercase">{t('appName')}</p>
          <p className="mt-2 max-w-md text-body-l text-brand-mist">{t('login.tagline')}</p>
          <span className="mt-8 block h-1 w-24 bg-brand-accent" />
        </div>
      </section>

      <section className="flex flex-col">
        <div className="flex items-center justify-between px-5 pt-6 lg:px-12">
          <span className="flex items-center gap-3 lg:invisible">
            <img src="/brand/logo-96.webp" alt="" width={99} height={96} className="h-12 w-auto" />
            <span className="font-display text-title font-bold tracking-[0.04em] text-brand-white uppercase">{t('appName')}</span>
          </span>
          <LanguageSwitch current={locale} change={setLoginLanguageAction} />
        </div>

        <div className="flex flex-1 items-center justify-center px-5 py-10 lg:px-12">
          <div className="w-full max-w-md rounded-modal bg-white p-6 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.8)] sm:p-8">
            <p className="text-small font-semibold tracking-[0.2em] text-brand-accent-deep uppercase">{t('login.brandLine')}</p>
            <h1 className="mt-2 font-display text-display-m leading-tight font-bold text-brand-obsidian">{t('login.welcome')}</h1>
            <p className="mt-1 text-crm-body text-brand-stone">{t('login.subtitle')}</p>
            <LoginForm action={submit} />
            <p className="mt-6 border-t border-brand-stone/15 pt-4 text-small text-brand-stone">{t('login.help')}</p>
          </div>
        </div>
      </section>
    </main>
  );
}
