import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { verifyToken } from '@mfp/core';
import { formatISTDate, toISTDate, type DietPlanDoc } from '@mfp/shared';
import { getContainer } from '@/lib/container';
import { PrintButton } from '@/components/join/print-button';
import { JoinPage, joinContext } from '@/lib/join-page';
import { loadGym } from '@/lib/gym';

/**
 * `/diet/{token}` — a member's own diet plan (ADR-089).
 *
 * The link arrives on WhatsApp and is private: not indexed, no referrer, and the token is
 * what says who the member is — never an id in the URL. It is laid out to be **printed**,
 * because a diet plan lives on a fridge door, so the print stylesheet drops the page
 * furniture and keeps the meals.
 *
 * The disclaimer is on the page, not in a footnote: this is general guidance from a gym,
 * and anybody with a condition needs a professional, which the page says in their language.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dietPlan' });
  return { title: t('metaTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function MemberDietPlanPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const ctx = await joinContext(params);
  const { token } = await params;
  const t = await getTranslations({ locale: ctx.locale, namespace: 'dietPlan' });
  const container = getContainer();

  const verified = verifyToken({ token, purpose: 'diet', secret: container.env.LINK_TOKEN_SECRET, clock: container.clock });
  const gym = await loadGym(container);
  const plan = !verified.valid
    ? null
    : await container.prisma.dietPlan.findFirst({
        where: { gymId: gym.id, memberId: verified.subject, status: 'READY' },
        orderBy: { version: 'desc' },
        select: { doc: true, bmiTenths: true, generatedAt: true, version: true, member: { select: { fullName: true, memberCode: true } } },
      });

  if (plan === null || plan.doc === null) {
    return (
      <JoinPage ctx={ctx}>
        <div className="bg-brand-paper">
          <div className="mx-auto max-w-xl px-5 py-16">
            <p role="alert" className="rounded-panel bg-brand-white p-6 text-body-l leading-body">
              {t('gone')}{' '}
              <a href={ctx.contact.telHref} className="font-semibold text-brand-link underline underline-offset-2">
                {ctx.contact.phoneDisplay}
              </a>
            </p>
          </div>
        </div>
      </JoinPage>
    );
  }

  const doc = plan.doc as DietPlanDoc;
  const bmi = plan.bmiTenths === null ? null : (plan.bmiTenths / 10).toFixed(1);

  return (
    <JoinPage ctx={ctx}>
      <div className="bg-brand-paper print:bg-white">
        <article className="mx-auto max-w-2xl px-5 py-10 print:max-w-none print:px-0 print:py-0">
          <header className="rounded-panel bg-brand-white p-6 print:rounded-none print:p-0">
            <p className="text-small font-semibold tracking-[0.18em] text-brand-stone uppercase">{gym.name}</p>
            <h1 className="font-display text-display-m mt-1 font-bold text-brand-obsidian">{t('h1', { name: plan.member.fullName })}</h1>
            <p className="mt-2 text-body text-brand-ink/80">
              {[
                plan.member.memberCode,
                plan.generatedAt === null ? null : t('written', { date: formatISTDate(toISTDate(plan.generatedAt), ctx.locale) }),
                t('version', { version: plan.version }),
              ]
                .filter((part) => part !== null)
                .join(' · ')}
            </p>

            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              {(
                [
                  ['calories', t('caloriesValue', { value: doc.caloriesPerDay })],
                  ['protein', t('proteinValue', { value: doc.proteinGramsPerDay })],
                  ['meals', String(doc.meals.length)],
                  ...(bmi === null ? [] : [['bmi', bmi] as const]),
                ] as ReadonlyArray<readonly [string, string]>
              ).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-small text-brand-stone">{t(`labels.${key}` as never)}</dt>
                  <dd className="font-display text-title font-bold text-brand-obsidian">{value}</dd>
                </div>
              ))}
            </dl>
            {bmi === null ? null : <p className="mt-3 text-small text-brand-stone">{t('bmiNote')}</p>}
          </header>

          <p className="mt-6 rounded-panel bg-brand-white p-6 text-body-l leading-body print:rounded-none print:p-0">{doc.summary}</p>

          <section className="mt-6 grid gap-3" aria-label={t('mealsHeading')}>
            <h2 className="font-display text-title font-bold text-brand-obsidian">{t('mealsHeading')}</h2>
            {doc.meals.map((meal, index) => (
              <div key={`${meal.name}-${index}`} className="rounded-panel bg-brand-white p-5 print:break-inside-avoid print:rounded-none print:border-b print:border-brand-stone/30">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-body-l font-semibold text-brand-obsidian">{meal.name}</h3>
                  <span className="text-body text-brand-stone">{meal.timing}</span>
                </div>
                <ul className="mt-2 grid list-disc gap-1 pl-5 text-body leading-body">
                  {meal.items.map((item, itemIndex) => (
                    <li key={`${item}-${itemIndex}`}>{item}</li>
                  ))}
                </ul>
                {meal.note === undefined ? null : <p className="mt-2 text-small text-brand-ink/80">{meal.note}</p>}
              </div>
            ))}
          </section>

          <section className="mt-6 grid gap-4 rounded-panel bg-brand-white p-6 print:rounded-none print:p-0">
            <div>
              <h2 className="text-body-l font-semibold text-brand-obsidian">{t('hydration')}</h2>
              <p className="mt-1 text-body leading-body">{doc.hydration}</p>
            </div>
            <div>
              <h2 className="text-body-l font-semibold text-brand-obsidian">{t('portions')}</h2>
              <p className="mt-1 text-body leading-body">{doc.portionGuidance}</p>
            </div>
            {doc.generalAdvice.length === 0 ? null : (
              <div>
                <h2 className="text-body-l font-semibold text-brand-obsidian">{t('advice')}</h2>
                <ul className="mt-1 grid list-disc gap-1 pl-5 text-body leading-body">
                  {doc.generalAdvice.map((line, index) => (
                    <li key={`${line}-${index}`}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <p className="mt-6 rounded-panel border border-brand-stone/30 p-5 text-small leading-body text-brand-ink/80">
            {doc.seeProfessional ? t('seeProfessional') : t('disclaimer')}
          </p>

          <div className="mt-6 print:hidden">
            <PrintButton label={t('print')} />
          </div>
        </article>
      </div>
    </JoinPage>
  );
}
