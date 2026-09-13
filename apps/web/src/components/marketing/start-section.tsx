import { getTranslations } from 'next-intl/server';
import { Section, SectionHeading } from './section';

/**
 * How to start (PRD LP-08, wireframe §6).
 *
 * Numbered because it is a real sequence. Steps are joined by a single rule behind the
 * numbers — vertical on phones, horizontal on desktop — rather than arrows appended to
 * text (Phase 2 quality bar).
 */

const STEPS = ['visit', 'trial', 'plan', 'trainer'] as const;

export async function StartSection({ phoneDisplay }: { phoneDisplay: string }) {
  const t = await getTranslations('start');

  return (
    <Section tone="chalk" labelledBy="start-heading">
      <SectionHeading id="start-heading" className="text-brand-plate-navy">
        {t('h2')}
      </SectionHeading>

      <ol className="relative mt-10 grid gap-8 md:grid-cols-4 md:gap-6">
        <div aria-hidden className="absolute top-2 bottom-2 left-6 w-px bg-brand-rubber-grey/30 md:hidden" />
        <div aria-hidden className="absolute top-6 right-[12%] left-6 hidden h-px bg-brand-rubber-grey/30 md:block" />
        {STEPS.map((step, index) => (
          <li key={step} className="relative flex gap-4 md:flex-col md:gap-5">
            <span
              className="relative z-10 flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-brand-plate-navy bg-brand-chalk font-display text-display-m leading-none font-bold text-brand-plate-navy"
              aria-label={t('stepLabel', { n: index + 1 })}
            >
              {index + 1}
            </span>
            <div>
              <h3 className="text-title font-semibold text-brand-plate-navy">{t(`steps.${step}.title`)}</h3>
              <p className="mt-1 text-body leading-body text-brand-ink/80">
                {step === 'visit' ? t('steps.visit.body', { phone: phoneDisplay }) : t(`steps.${step}.body`)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
