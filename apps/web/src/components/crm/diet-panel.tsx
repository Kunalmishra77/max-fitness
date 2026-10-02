import { getTranslations } from 'next-intl/server';
import type { DietPlanDoc } from '@mfp/shared';
import { formatISTDate, toISTDate } from '@mfp/shared';
import { CrmIcon } from '@/components/crm/crm-icons';
import { cn } from '@/lib/cn';

/**
 * A member's diet plan, on their profile (ADR-089).
 *
 * The current plan in full, because the question staff get asked is "what are they meant to
 * be eating?" and a link to go and look is one tap too many at a desk. Older plans are
 * listed but not opened: they are history, and history is for checking, not for following.
 *
 * A failed plan says what went wrong in words. Hiding it would leave the member looking
 * like somebody nobody ever got round to.
 */

export interface DietPanelPlan {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly bmiTenths: number | null;
  readonly doc: unknown;
  readonly answers: unknown;
  readonly failureReason: string | null;
  readonly generatedAt: Date | null;
  readonly sentAt: Date | null;
}

export async function DietPanel({ plans, locale }: { readonly plans: readonly DietPanelPlan[]; readonly locale: string }) {
  const t = await getTranslations('crm.diet');
  const tp = await getTranslations('crm.profile');
  if (plans.length === 0) return null;

  const current = plans.find((plan) => plan.status === 'READY') ?? plans[0];
  if (current === undefined) return null;
  const doc = current.status === 'READY' && current.doc !== null ? (current.doc as DietPlanDoc) : null;
  const answers = (current.answers ?? {}) as { goal?: string; dietType?: string; weightGrams?: number; heightCm?: number };
  const older = plans.filter((plan) => plan.id !== current.id);

  return (
    <section className="mt-3 bg-white px-4 py-4 lg:rounded-panel lg:border lg:border-brand-stone/15 lg:px-6 lg:shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-crm-body font-bold text-brand-obsidian">
          <CrmIcon name="diet" className="size-5 text-brand-stone" />
          {t('title')}
        </h2>
        <p className="text-small text-brand-stone">
          {[
            t('ready', { version: current.version }),
            current.generatedAt === null ? null : formatISTDate(toISTDate(current.generatedAt), locale),
            current.sentAt === null ? t('notSent') : t('sent'),
          ]
            .filter((part) => part !== null)
            .join(' · ')}
        </p>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        {(
          [
            ['goal', answers.goal === undefined ? null : t(`goals.${answers.goal}` as never)],
            ['dietType', answers.dietType === undefined ? null : tp(`dietTypes.${answers.dietType}` as never)],
            ['weight', answers.weightGrams === undefined ? null : `${answers.weightGrams / 1000} kg`],
            ['bmi', current.bmiTenths === null ? null : (current.bmiTenths / 10).toFixed(1)],
          ] as ReadonlyArray<readonly [string, string | null]>
        ).map(([key, value]) => (
          <div key={key}>
            <dt className="text-small text-brand-stone">{tp(`diet.${key}` as never)}</dt>
            <dd className={cn('text-crm-body', value === null ? 'text-brand-stone italic' : 'font-semibold text-brand-obsidian')}>{value ?? tp('notGiven')}</dd>
          </div>
        ))}
      </dl>

      {doc === null ? (
        <p role="status" className="mt-3 rounded-input bg-tint-fee-expired-bg p-3 text-crm-body font-semibold text-semantic-fee-expired">
          {t('failed', { reason: t(`reasons.${current.failureReason ?? 'generic'}` as never) })}
        </p>
      ) : (
        <>
          <p className="mt-3 text-crm-body text-brand-ink">{doc.summary}</p>
          <p className="mt-1 text-small text-brand-stone">
            {t('caloriesLine', { calories: doc.caloriesPerDay, protein: doc.proteinGramsPerDay, meals: doc.meals.length })}
          </p>
          <ul className="mt-3 divide-y divide-brand-stone/15">
            {doc.meals.map((meal, index) => (
              <li key={`${meal.name}-${index}`} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-crm-body font-semibold text-brand-obsidian">{meal.name}</span>
                  <span className="text-small text-brand-stone">{meal.timing}</span>
                </div>
                <p className="mt-1 text-small text-brand-ink">{meal.items.join(' · ')}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {older.length === 0 ? null : (
        <ul className="mt-3 border-t border-brand-stone/15 pt-3">
          {older.map((plan) => (
            <li key={plan.id} className="flex items-baseline justify-between gap-3 py-1 text-small text-brand-stone">
              <span>{t('ready', { version: plan.version })}</span>
              <span>{plan.generatedAt === null ? t(`reasons.${plan.failureReason ?? 'generic'}` as never) : formatISTDate(toISTDate(plan.generatedAt), locale)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
