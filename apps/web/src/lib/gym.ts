import { GymSettingsSchema, type GymSettings } from '@mfp/shared';
import type { CheckoutSettings } from '@mfp/core';
import type { Container } from './container';

/**
 * The gym a public request acts on, with its settings, for anything that charges money.
 *
 * Unlike the landing page (landing-data.ts), this never falls back to defaults: a
 * missing gym or settings that fail validation must stop a checkout, not quietly
 * price it without the admission fee. Read on each request — one indexed lookup —
 * so an owner's settings change applies to the very next order.
 */

export interface GymContext {
  readonly id: string;
  readonly settings: GymSettings;
}

export class GymNotConfiguredError extends Error {
  constructor(reason: string) {
    super(`Gym not configured: ${reason}`);
    this.name = 'GymNotConfiguredError';
  }
}

export async function loadGym({ prisma, env }: Pick<Container, 'prisma' | 'env'>): Promise<GymContext> {
  const gym = await prisma.gym.findUnique({ where: { slug: env.GYM_SLUG }, select: { id: true, settings: true } });
  if (gym === null) throw new GymNotConfiguredError('no gym for GYM_SLUG');

  const settings = GymSettingsSchema.safeParse(gym.settings);
  if (!settings.success) throw new GymNotConfiguredError('settings failed validation');

  return { id: gym.id, settings: settings.data };
}

export function checkoutSettingsOf(settings: GymSettings): CheckoutSettings {
  return {
    pricing: settings.pricing,
    maxStartDateDaysAhead: settings.membership.maxStartDateDaysAhead,
    renewalGraceDays: settings.membership.renewalGraceDays,
  };
}
