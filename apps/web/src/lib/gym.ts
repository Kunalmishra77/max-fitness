import { cache } from 'react';
import { GymSettingsSchema, type GymSettings } from '@mfp/shared';
import type { CheckoutSettings } from '@mfp/core';
import type { Container } from './container';
import { withOneRetry } from './retry';

/**
 * The gym a public request acts on, with its settings, for anything that charges money.
 *
 * Unlike the landing page (landing-data.ts), this never falls back to defaults: a
 * missing gym or settings that fail validation must stop a checkout, not quietly
 * price it without the admission fee. Read on each request — one indexed lookup —
 * so an owner's settings change applies to the very next order.
 *
 * **Once per request, not once per caller** (PERF-001). The lookup is memoised with
 * React's `cache`, which is scoped to a single request and nothing wider: an owner who
 * changes a price still sees it on the very next request, exactly as before.
 *
 * The reason is the CRM. `requireCrmContext()` loaded the gym itself *and* loaded it
 * again inside `currentActor()`, and every CRM screen calls `requireCrmContext()` twice
 * — once in the route group's layout, once in the page. That was six serial round trips
 * to Mumbai before a screen's own first query had even been sent. Memoised, it is two.
 */

export interface GymContext {
  readonly id: string;
  /** Shown to a phone as it pairs, so the person holding it can see it joined the right gym. */
  readonly name: string;
  readonly settings: GymSettings;
}

export class GymNotConfiguredError extends Error {
  constructor(reason: string) {
    super(`Gym not configured: ${reason}`);
    this.name = 'GymNotConfiguredError';
  }
}

/**
 * The memoised read.
 *
 * Keyed on the arguments, so both have to be stable for a request to get one query:
 * `prisma` is the process-wide client (ADR-010) and the slug is a string from the
 * environment. Outside a request — a script, a test — `cache` calls straight through
 * and nothing is shared.
 */
const readGym = cache(async (prisma: Container['prisma'], slug: string): Promise<GymContext> => {
  // A dropped pooled connection must not read as "this gym is not configured", which is
  // a hard failure on a checkout. Only the query is retried; a `null` row is an answer.
  const gym = await withOneRetry(() => prisma.gym.findUnique({ where: { slug }, select: { id: true, name: true, settings: true } }));
  if (gym === null) throw new GymNotConfiguredError('no gym for GYM_SLUG');

  const settings = GymSettingsSchema.safeParse(gym.settings);
  if (!settings.success) throw new GymNotConfiguredError('settings failed validation');

  return { id: gym.id, name: gym.name, settings: settings.data };
});

export async function loadGym({ prisma, env }: Pick<Container, 'prisma' | 'env'>): Promise<GymContext> {
  return readGym(prisma, env.GYM_SLUG);
}

export function checkoutSettingsOf(settings: GymSettings): CheckoutSettings {
  return {
    pricing: settings.pricing,
    // The trial lives under pricing in settings and is its own group here, because it is
    // not priced from the plan catalogue (ADR-088).
    trial: {
      trialEnabled: settings.pricing.trialEnabled,
      trialPerDayPaise: settings.pricing.trialPerDayPaise,
      trialDayOptions: settings.pricing.trialDayOptions,
    },
    maxStartDateDaysAhead: settings.membership.maxStartDateDaysAhead,
    renewalGraceDays: settings.membership.renewalGraceDays,
  };
}
