import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button';
import { ChatIcon } from './icons';
import { Eyebrow, Section } from './section';

/** Final CTA band (PRD LP-18, wireframe §14): the second Sign up on the page. */
export async function FinalCta({ whatsappHref }: { whatsappHref: string }) {
  const t = await getTranslations('finalCta');
  const tc = await getTranslations('common');

  return (
    <Section
      tone="navy"
      labelledBy="final-cta-heading"
      className="relative overflow-hidden bg-[radial-gradient(ellipse_at_80%_50%,rgb(217_15_31/0.45),transparent_60%),linear-gradient(120deg,#0a0a0b_40%,#1a0508)]"
    >
      {/* A giant outlined word behind the call to action (ADR-061). */}
      <span
        aria-hidden
        className="text-outline pointer-events-none absolute -right-6 -bottom-10 font-display text-[11rem] leading-none font-bold text-brand-paper/10 uppercase select-none md:text-[18rem]"
      >
        MAX
      </span>
      <div className="relative flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
        <div>
          <Eyebrow onDark>{t('eyebrow')}</Eyebrow>
          <h2 id="final-cta-heading" className="mt-4 max-w-[18ch] font-display text-display-l leading-display font-bold tracking-[0.01em] uppercase">
            {t('h2')}
          </h2>
          <p className="mt-3 text-body-l text-brand-mist">{t('sub')}</p>
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
