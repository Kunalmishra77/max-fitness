import { getTranslations } from 'next-intl/server';
import { planCards, ptCards, type Plan } from '@mfp/core';
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
  // One price for everyone today, so the men's list is the list (ADR-087).
  const pt = ptCards(plans, 'MALE', pricing);

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

      {/* Personal training, priced per month and bought with a membership (ADR-087). The
          prices are the same for men and women, so this is one list, not a toggle. */}
      {pt.length === 0 ? null : (
        <div className="mt-10">
          <h3 className="font-display text-title font-bold text-brand-obsidian">{t('ptH3')}</h3>
          <p className="mt-2 max-w-[65ch] text-body leading-body">{t('ptBody')}</p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {pt.map((card) => (
              <li key={card.planId} className="rounded-panel border border-brand-stone/20 bg-brand-paper p-5">
                <p className="text-small font-semibold tracking-[0.12em] text-brand-stone uppercase">{t('ptMonths', { count: card.durationMonths })}</p>
                <p className="mt-2 font-display text-title font-bold text-brand-accent-deep">{t('ptPerMonth', { price: price(card.perMonthPaise) })}</p>
                <p className="mt-1 text-small text-brand-ink/80">{t('ptTotal', { price: price(card.pricePaise) })}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-6 max-w-[65ch] text-small leading-body text-brand-stone">{t('note')}</p>
    </Section>
  );
}
