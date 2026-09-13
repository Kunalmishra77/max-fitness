import { getTranslations } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { ChatIcon } from './icons';
import { Section } from './section';

/**
 * Mid-page promo banner (PRD LP-11). Text comes from the CRM promo settings; the
 * section renders nothing when no promo is active (ADR-024).
 */
export async function PromoBanner({ text, whatsappHref }: { text: string | null; whatsappHref: string }) {
  if (text === null) return null;
  const t = await getTranslations('promo');

  return (
    <Section tone="red" className="relative">
      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <p className="max-w-[40ch] font-display text-display-m leading-tight font-semibold">{text}</p>
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          data-track="whatsapp_click"
          data-track-source="promo_banner"
          // White, not Chalk: Chalk on Signboard Red is 4.49:1, just under WCAG AA.
          className={cn(
            buttonVariants({ variant: 'outlineLight', size: 'hero' }),
            'border-brand-white text-brand-white hover:bg-brand-white/10',
          )}
        >
          <ChatIcon />
          {t('bannerCta')}
        </a>
      </div>
    </Section>
  );
}
