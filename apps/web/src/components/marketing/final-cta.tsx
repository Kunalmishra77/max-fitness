import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button';
import { ChatIcon } from './icons';
import { Section } from './section';

/** Final CTA band (PRD LP-18, wireframe §14): the second Sign up on the page. */
export async function FinalCta({ whatsappHref }: { whatsappHref: string }) {
  const t = await getTranslations('finalCta');
  const tc = await getTranslations('common');

  return (
    <Section tone="navy" labelledBy="final-cta-heading">
      <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 id="final-cta-heading" className="font-display text-display-l leading-display font-bold">
            {t('h2')}
          </h2>
          <p className="mt-3 text-body-l text-brand-chalk/85">{t('sub')}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link
            href="/join"
            data-track="signup_started"
            data-track-source="final_cta"
            className={buttonVariants({ variant: 'primary', size: 'hero' })}
          >
            {tc('signUp')}
          </Link>
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            data-track="whatsapp_click"
            data-track-source="final_cta"
            className={buttonVariants({ variant: 'outlineLight', size: 'hero' })}
          >
            <ChatIcon />
            {tc('whatsapp')}
          </a>
        </div>
      </div>
    </Section>
  );
}
