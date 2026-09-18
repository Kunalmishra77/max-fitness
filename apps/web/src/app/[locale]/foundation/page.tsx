import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  EnvValidationError,
  FEE_STATES,
  formatINR,
  systemClock,
  todayIST,
  type Env,
  type FeeState,
  type ISTDate,
  type PricedGender,
} from '@mfp/shared';
import { planCards, type Plan } from '@mfp/core';
import { getContainer } from '@/lib/container';

/**
 * Foundation check — Phase 1 only.
 *
 * This page exists to prove the whole stack is wired: Next renders it, it reads
 * plans and members from Supabase through Prisma, and the per-month and savings
 * figures beside each price are computed by `packages/core` rather than by the
 * page. If those numbers are right, pricing, the database connection and the
 * package boundaries all work.
 *
 * It is not part of the product. Phase 2 replaces it with the real landing page.
 */

export const dynamic = 'force-dynamic';

interface FeeStateCount {
  readonly feeState: FeeState;
  readonly count: number;
}

type LoadError = 'config' | 'database';

interface PageData {
  readonly plans: Plan[];
  readonly feeStates: FeeStateCount[];
  readonly memberTotal: number;
  readonly error: LoadError | null;
  /** The error's class name only — its message may contain configuration details. */
  readonly errorDetail: string | null;
  /** `null` when the environment itself failed to load. */
  readonly env: Env | null;
  readonly today: ISTDate;
}

export default async function FoundationCheckPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('foundation');
  const tf = await getTranslations('feeState');
  const tc = await getTranslations('common');

  const data = await loadData();
  const { env, today } = data;

  return (
    <main className="mx-auto max-w-[var(--size-content-max)] px-5 py-10 md:px-6 md:py-16">
      <header className="mb-10">
        <p className="mb-2 text-[length:var(--text-small)] font-medium tracking-wide text-[var(--color-brand-stone)]">
          {t('notForCustomers')}
        </p>
        <h1 className="font-[var(--font-display)] text-[length:var(--text-display-l)] text-[var(--color-brand-obsidian)]">
          {tc('gymName')}
        </h1>
        <p className="mt-1 font-[var(--font-display)] text-[length:var(--text-display-m)] text-[var(--color-brand-accent)]">
          {t('title')}
        </p>
        <p className="mt-3 max-w-[65ch] text-[length:var(--text-body)] text-[var(--color-brand-stone)]">
          {t('subtitle')}
        </p>
      </header>

      {data.error !== null ? (
        <section
          role="alert"
          className="rounded-[var(--radius-panel)] border border-[var(--color-semantic-fee-expired)]/30 bg-[var(--color-tint-fee-expired-bg)] p-5"
        >
          <p className="font-semibold text-[var(--color-semantic-fee-expired)]">{tc('error')}</p>
          <p className="mt-1 text-[length:var(--text-body)]">
            {t(data.error === 'config' ? 'configError' : 'dbError')}
          </p>
          {data.errorDetail !== null ? (
            <p className="mt-2 font-mono text-[length:var(--text-small)] text-[var(--color-brand-stone)]">
              {data.errorDetail}
            </p>
          ) : null}
        </section>
      ) : (
        <>
          <PlanSection
            plans={data.plans}
            heading={t('plansHeading')}
            note={t('plansNote')}
            emptyLabel={t('noPlans')}
            labels={{ male: t('male'), female: t('female'), bestValue: t('bestValue') }}
            renderPerMonth={(amount) => t('perMonth', { amount })}
            renderSave={(amount) => t('save', { amount })}
            renderMonths={(count) => t('months', { count })}
          />

          <section className="mt-14">
            <h2 className="font-[var(--font-display)] text-[length:var(--text-display-m)] text-[var(--color-brand-obsidian)]">
              {t('feeStatesHeading')}
            </h2>
            <p className="mt-1 text-[length:var(--text-small)] text-[var(--color-brand-stone)]">
              {t('feeStatesNote')} · {today}
            </p>

            {data.memberTotal === 0 ? (
              <p className="mt-5 rounded-[var(--radius-panel)] border border-[var(--color-brand-stone)]/20 bg-white p-5">
                {t('noMembers')}
              </p>
            ) : (
              <ul className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                {data.feeStates.map(({ feeState, count }) => (
                  <li
                    key={feeState}
                    className="rounded-[var(--radius-crm-tile)] border border-[var(--color-brand-stone)]/20 p-5"
                    style={{ backgroundColor: tintFor(feeState) }}
                  >
                    <p
                      className="tabular font-[var(--font-display)] text-[length:var(--text-crm-number)] leading-[var(--leading-tight)]"
                      style={{ color: colourFor(feeState) }}
                    >
                      {count}
                    </p>
                    <p className="mt-1 text-[length:var(--text-body)] font-medium text-[var(--color-brand-ink)]">
                      {tf(feeStateKey(feeState))}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <section className="mt-14 border-t border-[var(--color-brand-stone)]/20 pt-6">
        <h2 className="font-[var(--font-display)] text-[length:var(--text-title)] text-[var(--color-brand-obsidian)]">
          {t('stackHeading')}
        </h2>
        <dl className="mt-3 grid gap-x-8 gap-y-1 text-[length:var(--text-small)] text-[var(--color-brand-stone)] md:grid-cols-2">
          <StackRow label={t('stack.locale')} value={locale} />
          <StackRow label={t('stack.today')} value={today} />
          <StackRow label={t('stack.demoMode')} value={env === null ? '—' : String(env.DEMO_MODE)} />
          <StackRow label={t('stack.whatsappProvider')} value={env?.WHATSAPP_PROVIDER ?? '—'} />
          <StackRow label={t('stack.storageDriver')} value={env?.STORAGE_DRIVER ?? '—'} />
          <StackRow label={t('stack.health')} value="/api/v1/health" />
        </dl>
      </section>
    </main>
  );
}

function StackRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[var(--color-brand-stone)]/10 py-1">
      <dt>{label}</dt>
      <dd className="min-w-0 text-right font-mono break-all text-[var(--color-brand-ink)]">{value}</dd>
    </div>
  );
}

function PlanSection({
  plans,
  heading,
  note,
  emptyLabel,
  labels,
  renderPerMonth,
  renderSave,
  renderMonths,
}: {
  plans: Plan[];
  heading: string;
  note: string;
  emptyLabel: string;
  labels: { male: string; female: string; bestValue: string };
  renderPerMonth: (amount: string) => string;
  renderSave: (amount: string) => string;
  renderMonths: (count: number) => string;
}) {
  if (plans.length === 0) {
    return (
      <section>
        <h2 className="font-[var(--font-display)] text-[length:var(--text-display-m)] text-[var(--color-brand-obsidian)]">
          {heading}
        </h2>
        <p className="mt-5 rounded-[var(--radius-panel)] border border-[var(--color-brand-stone)]/20 bg-white p-5">
          {emptyLabel}
        </p>
      </section>
    );
  }

  // Pricing settings are not read from the gym row here on purpose: this page is
  // checking that the pricing functions work, not that settings load.
  const settings = {
    admissionFeePaise: 0,
    otherGenderPricing: 'ASK_AT_DESK' as const,
    allowDeskDiscounts: true,
  };

  const genders: Array<{ gender: PricedGender; label: string }> = [
    { gender: 'MALE', label: labels.male },
    { gender: 'FEMALE', label: labels.female },
  ];

  return (
    <section>
      <h2 className="font-[var(--font-display)] text-[length:var(--text-display-m)] text-[var(--color-brand-obsidian)]">
        {heading}
      </h2>
      <p className="mt-1 max-w-[65ch] text-[length:var(--text-small)] text-[var(--color-brand-stone)]">
        {note}
      </p>

      {genders.map(({ gender, label }) => (
        <div key={gender} className="mt-7">
          <h3 className="text-[length:var(--text-title)] font-semibold text-[var(--color-brand-ink)]">{label}</h3>
          <ul className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {planCards(plans, gender, settings).map((card) => (
              <li
                key={card.planId}
                className={
                  card.isBestValue
                    ? 'rounded-[var(--radius-panel)] border-2 border-[var(--color-brand-medal-gold)] bg-white p-5'
                    : 'rounded-[var(--radius-panel)] border border-[var(--color-brand-stone)]/20 bg-white p-5'
                }
              >
                {card.isBestValue ? (
                  <p className="mb-2 inline-block rounded-[var(--radius-button)] bg-[var(--color-brand-medal-gold)]/15 px-2 py-0.5 text-[length:var(--text-small)] font-semibold text-[var(--color-brand-obsidian)]">
                    {labels.bestValue}
                  </p>
                ) : null}
                <p className="text-[length:var(--text-small)] font-medium text-[var(--color-brand-stone)]">
                  {renderMonths(card.durationMonths)}
                </p>
                <p className="tabular mt-1 font-[var(--font-display)] text-[length:var(--text-display-m)] leading-[var(--leading-tight)] text-[var(--color-brand-accent)]">
                  {formatINR(card.pricePaise)}
                </p>
                <p className="tabular mt-1 text-[length:var(--text-body)] text-[var(--color-brand-ink)]">
                  {renderPerMonth(formatINR(card.perMonthPaise))}
                </p>
                {card.showSavings ? (
                  <p className="tabular mt-1 text-[length:var(--text-small)] font-semibold text-[var(--color-semantic-fee-paid)]">
                    {renderSave(formatINR(card.savingsPaise))}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/**
 * Read the two things this page proves: the plan catalogue, and today's fee-state
 * counts from the `v_member_fee` read model (database-design.md §4.1).
 *
 * Every failure becomes a designed error state rather than a 500
 * (coding-standards.md §4) — and the two kinds are kept apart, because "the .env
 * file is incomplete" and "Supabase is unreachable" are fixed in different places.
 * Neither ever shows the underlying message: a driver error can contain the
 * connection string, and an env error names configuration keys (CLAUDE.md §2.8).
 */
async function loadData(): Promise<PageData> {
  const empty = { plans: [], feeStates: [], memberTotal: 0 };

  let container: ReturnType<typeof getContainer>;
  try {
    container = getContainer();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      // Key names and reasons only; EnvValidationError never includes values.
      console.error('[foundation] invalid environment:', error.issues.join('; '));
    }
    return {
      ...empty,
      error: error instanceof EnvValidationError ? 'config' : 'database',
      errorDetail: error instanceof Error ? error.name : 'Error',
      env: null,
      today: todayIST(systemClock),
    };
  }

  const { prisma, env, clock } = container;
  const today = todayIST(clock);

  try {
    const gym = await prisma.gym.findUnique({ where: { slug: env.GYM_SLUG }, select: { id: true } });

    if (gym === null) {
      return { ...empty, error: null, errorDetail: null, env, today };
    }

    const [planRows, counts] = await Promise.all([
      prisma.plan.findMany({
        where: { gymId: gym.id, isActive: true },
        orderBy: [{ gender: 'asc' }, { durationMonths: 'asc' }],
      }),
      prisma.$queryRaw<Array<{ feeState: string; count: bigint }>>`
        SELECT f."feeState", COUNT(*) AS count
        FROM "Member" mem
        JOIN "v_member_fee" f ON f."memberId" = mem."id"
        WHERE mem."gymId" = ${gym.id}
          AND mem."deletedAt" IS NULL
          AND mem."status" = 'ACTIVE'
        GROUP BY f."feeState"
      `,
    ]);

    const byState = new Map(counts.map((row) => [row.feeState, Number(row.count)]));

    return {
      plans: planRows.map(toPlan),
      // Every state is listed, including the empty ones: a missing tile reads as a
      // bug, whereas a zero reads as information.
      feeStates: FEE_STATES.map((feeState) => ({ feeState, count: byState.get(feeState) ?? 0 })),
      memberTotal: [...byState.values()].reduce((a, b) => a + b, 0),
      error: null,
      errorDetail: null,
      env,
      today,
    };
  } catch (error) {
    return {
      ...empty,
      error: 'database',
      errorDetail: error instanceof Error ? error.name : 'Error',
      env,
      today,
    };
  }
}

function toPlan(row: {
  id: string;
  code: string;
  durationMonths: number;
  gender: string;
  pricePaise: number;
  isActive: boolean;
  sortOrder: number;
}): Plan {
  return {
    id: row.id,
    code: row.code as Plan['code'],
    durationMonths: row.durationMonths as Plan['durationMonths'],
    gender: row.gender as PricedGender,
    pricePaise: row.pricePaise,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

function feeStateKey(state: FeeState): 'paid' | 'dueSoon' | 'expired' | 'none' {
  const keys = { PAID: 'paid', DUE_SOON: 'dueSoon', EXPIRED: 'expired', NONE: 'none' } as const;
  return keys[state];
}

const FEE_STATE_COLOUR: Readonly<Record<FeeState, string>> = {
  PAID: 'var(--color-semantic-fee-paid)',
  DUE_SOON: 'var(--color-semantic-fee-due-soon)',
  EXPIRED: 'var(--color-semantic-fee-expired)',
  NONE: 'var(--color-semantic-fee-none)',
};

const FEE_STATE_TINT: Readonly<Record<FeeState, string>> = {
  PAID: 'var(--color-tint-fee-paid-bg)',
  DUE_SOON: 'var(--color-tint-fee-due-soon-bg)',
  EXPIRED: 'var(--color-tint-fee-expired-bg)',
  NONE: 'var(--color-tint-fee-none-bg)',
};

function colourFor(state: FeeState): string {
  return FEE_STATE_COLOUR[state];
}

function tintFor(state: FeeState): string {
  return FEE_STATE_TINT[state];
}
