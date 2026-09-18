import { getTranslations } from 'next-intl/server';
import { planCards, type Plan } from '@mfp/core';
import type { PricingSettings } from '@mfp/shared';
import { buttonVariants } from '@/components/ui/button';
import { price } from '@/lib/format';
import { FeeBoard, type FeeRow } from './fee-board';
import { ChatIcon, PhoneIcon } from './icons';
import { Section, SectionHeading } from './section';

/**
 * Membership fees (PRD LP-09). Server side: plans from the cached landing read, every
 * figure from packages/core pricing, then handed to the toggle as finished rows.
 * With no live prices, a designed fallback points to call and WhatsApp instead of
 * showing stale or invented numbers.
 */

function rowsFor(plans: readonly Plan[], gender: 'MALE' | 'FEMALE', pricing: PricingSettings): FeeRow[] {
  return planCards(plans, gender, pricing).map((card) => ({
    code: card.code,
    months: card.durationMonths,
    price: price(card.pricePaise),
    perMonth: price(card.perMonthPaise),
    saving: card.showSavings ? price(card.savingsPaise) : null,
    bestValue: card.isBestValue,
  }));
}

export async function PlansSection({
  plans,
  pricing,
  telHref,
  phoneDisplay,
  whatsappHref,
}: {
  plans: readonly Plan[];
  pricing: PricingSettings;
  telHref: string;
  phoneDisplay: string;
  whatsappHref: string;
}) {
  const t = await getTranslations('plans');
  const tn = await getTranslations('nav');
  const tc = await getTranslations('common');

  const men = rowsFor(plans, 'MALE', pricing);
  const women = rowsFor(plans, 'FEMALE', pricing);
  const available = men.length > 0 && women.length > 0;

  return (
    <Section id="plans" tone="white" labelledBy="plans-heading">
      <SectionHeading id="plans-heading" eyebrow={t('eyebrow')} className="text-brand-obsidian">
        {t('h2')}
      </SectionHeading>

      {available ? (
        <FeeBoard men={men} women={women} />
      ) : (
        <div role="status" className="mt-8 max-w-2xl rounded-panel border border-brand-stone/20 bg-brand-paper p-6">
          <p className="text-body-l leading-body">{t('unavailable')}</p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <a href={telHref} data-track="call_click" data-track-source="plans" className={buttonVariants({ variant: 'primary' })}>
              <PhoneIcon />
              {tn('call', { phone: phoneDisplay })}
            </a>
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              data-track="whatsapp_click"
              data-track-source="plans"
              className={buttonVariants({ variant: 'outlineDark' })}
            >
              <ChatIcon />
              {tc('whatsapp')}
            </a>
          </div>
        </div>
      )}

      <p className="mt-6 max-w-[65ch] text-small leading-body text-brand-stone">{t('note')}</p>
    </Section>
  );
}
