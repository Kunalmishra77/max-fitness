import { unstable_cache } from 'next/cache';
import { GymSettingsSchema, defaultGymSettings, type GymSettings, type PricedGender } from '@mfp/shared';
import type { Plan } from '@mfp/core';
import { getContainer } from './container';

/**
 * Data behind the public landing page (ADR-022).
 *
 * Read through `unstable_cache` with the tags `plans` and `settings` and a 5-minute
 * revalidate, so the page renders from a cached read and the CRM can refresh it
 * instantly with `revalidateLandingContent()` when the owner edits prices or promo.
 *
 * The landing page must never fail because the database is slow or down: on any
 * error this returns defaults with `available: false`, and the sections that need
 * live data (the fee board) show their designed fallback while the rest of the page
 * — copy, photos, contact — still works.
 */

export const LANDING_TAGS = ['plans', 'settings'] as const;

export interface LandingGym {
  readonly name: string;
  readonly phone: string;
  readonly addressLine: string;
  readonly city: string;
  readonly state: string;
  readonly pincode: string;
}

export interface LandingData {
  readonly available: boolean;
  readonly gym: LandingGym | null;
  readonly settings: GymSettings;
  readonly plans: Plan[];
}

const loadFromDatabase = unstable_cache(
  async (slug: string): Promise<LandingData> => {
    const { prisma } = getContainer();
    const gym = await prisma.gym.findUnique({
      where: { slug },
      select: { id: true, name: true, phone: true, addressLine: true, city: true, state: true, pincode: true, settings: true },
    });

    if (gym === null) {
      return { available: false, gym: null, settings: defaultGymSettings(), plans: [] };
    }

    const parsedSettings = GymSettingsSchema.safeParse(gym.settings);
    if (!parsedSettings.success) {
      console.error('[landing] gym settings failed validation; using defaults');
    }

    const planRows = await prisma.plan.findMany({
      where: { gymId: gym.id, isActive: true },
      orderBy: [{ gender: 'asc' }, { durationMonths: 'asc' }],
      select: { id: true, code: true, durationMonths: true, gender: true, pricePaise: true, isActive: true, sortOrder: true },
    });

    return {
      available: true,
      gym: {
        name: gym.name,
        phone: gym.phone,
        addressLine: gym.addressLine,
        city: gym.city,
        state: gym.state,
        pincode: gym.pincode,
      },
      settings: parsedSettings.success ? parsedSettings.data : defaultGymSettings(),
      plans: planRows.map((row) => ({
        id: row.id,
        code: row.code as Plan['code'],
        durationMonths: row.durationMonths as Plan['durationMonths'],
        gender: row.gender as PricedGender,
        pricePaise: row.pricePaise,
        isActive: row.isActive,
        sortOrder: row.sortOrder,
      })),
    };
  },
  ['landing-data-v1'],
  { tags: [...LANDING_TAGS], revalidate: 300 },
);

export async function getLandingData(): Promise<LandingData> {
  try {
    const { env } = getContainer();
    return await loadFromDatabase(env.GYM_SLUG);
  } catch (error) {
    console.error(`[landing] live data unavailable: ${error instanceof Error ? error.name : 'Error'}`);
    return { available: false, gym: null, settings: defaultGymSettings(), plans: [] };
  }
}
