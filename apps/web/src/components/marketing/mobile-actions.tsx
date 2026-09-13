import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ChatIcon, PhoneIcon } from './icons';

/**
 * Always-reachable actions (PRD LP-21, wireframe §17). Plain links, no client JS.
 *
 * Phones get a bottom bar with Call, WhatsApp and Sign up; wider screens get a single
 * WhatsApp button, because the navigation already carries Call and Sign up there.
 */

export async function MobileStickyBar({ telHref, whatsappHref }: { telHref: string; whatsappHref: string }) {
  const t = await getTranslations('sticky');
  const item = 'flex min-h-14 flex-col items-center justify-center gap-0.5 text-small font-semibold';

  return (
    <nav
      aria-label={t('label')}
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-brand-chalk/15 bg-brand-plate-navy pb-[env(safe-area-inset-bottom)] text-brand-chalk md:hidden"
    >
      <a href={telHref} data-track="call_click" data-track-source="sticky_bar" className={item}>
        <PhoneIcon className="text-[1.15rem]" />
        {t('call')}
      </a>
      <a
        href={whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
        data-track="whatsapp_click"
        data-track-source="sticky_bar"
        className={item}
      >
        <ChatIcon className="text-[1.15rem]" />
        {t('whatsapp')}
      </a>
      <Link
        href="/join"
        data-track="signup_started"
        data-track-source="sticky_bar"
        className={`${item} bg-brand-signboard-red text-body text-brand-white`}
      >
        {t('signUp')}
      </Link>
    </nav>
  );
}

export async function WhatsAppFloat({ whatsappHref }: { whatsappHref: string }) {
  const t = await getTranslations('common');

  return (
    <a
      href={whatsappHref}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('whatsapp')}
      data-track="whatsapp_click"
      data-track-source="float"
      className="fixed right-6 bottom-6 z-40 hidden size-14 items-center justify-center rounded-full border-2 border-brand-chalk/70 bg-brand-plate-navy text-[1.5rem] text-brand-chalk shadow-[var(--shadow-overlay)] hover:border-brand-chalk md:flex"
    >
      <ChatIcon />
    </a>
  );
}
