import { GymSettingsSchema, type Clock, type GymSettings } from '@mfp/shared';
import { DomainError } from '../errors';
import { assertCan, type CrmActor } from './permissions';

/**
 * The owner's settings (crm-ux-blueprint §14; crm-module-spec §3).
 *
 * Two things the owner changes most: plan prices (the `Plan` rows) and the parts of
 * `Gym.settings` the screen manages — the admission fee, the minimum age, the website's
 * promo and trust numbers, and opening hours.
 *
 * Both need `settings.manage`, which is the owner **with a PIN entered in the last
 * few minutes**: a phone left unlocked on the desk must not be able to change what the
 * gym charges. Both are validated by the same schema the rest of the app reads with,
 * both leave an audit row with before and after, and a save that changes nothing
 * writes nothing — so the audit log is a list of real changes, not of button presses.
 *
 * BR-2.8 holds by construction: a price lives on the plan and is copied onto each
 * membership at sale, so nothing here touches a membership.
 */

export interface SettingsAuditEntry {
  readonly gymId: string;
  readonly actorType: 'staff';
  readonly actorId: string;
  readonly action: 'settings.update' | 'plans.price';
  readonly entityType: 'Gym' | 'Plan';
  readonly entityId: string | null;
  readonly before: Readonly<Record<string, unknown>>;
  readonly after: Readonly<Record<string, unknown>>;
}

export interface SettingsStore {
  /** The stored document as it is; it is parsed here, in one place. Locks the gym row. */
  loadSettings(gymId: string): Promise<unknown>;
  saveSettings(gymId: string, settings: GymSettings): Promise<void>;
  loadPlans(gymId: string): Promise<ReadonlyArray<{ readonly code: string; readonly pricePaise: number }>>;
  savePlanPrice(gymId: string, code: string, pricePaise: number): Promise<void>;
  writeAudit(entry: SettingsAuditEntry): Promise<void>;
}

export interface SettingsUnitOfWork {
  transaction<T>(work: (store: SettingsStore) => Promise<T>): Promise<T>;
}

interface SettingsDeps {
  readonly actor: CrmActor;
  readonly clock: Clock;
  readonly uow: SettingsUnitOfWork;
}

/** ₹100 to ₹1,00,000: anything outside is a typo, not a price. */
export const MIN_PLAN_PRICE_PAISE = 10_000;
export const MAX_PLAN_PRICE_PAISE = 10_000_000;

/** Prices are set in whole rupees; paise exist only because money is stored as integers. */
const isWholeRupees = (paise: number) => Number.isInteger(paise) && paise % 100 === 0;

// ── Plan prices ─────────────────────────────────────────────────────────────

export async function updatePlanPrices(
  input: { readonly prices: ReadonlyArray<{ readonly code: string; readonly pricePaise: number }> },
  deps: SettingsDeps,
): Promise<{ readonly changed: number }> {
  assertCan(deps.actor, 'settings.manage', deps.clock.now());

  for (const price of input.prices) {
    if (!isWholeRupees(price.pricePaise) || price.pricePaise < MIN_PLAN_PRICE_PAISE || price.pricePaise > MAX_PLAN_PRICE_PAISE) {
      throw new DomainError('VALIDATION_FAILED', 'A plan price is whole rupees between ₹100 and ₹1,00,000', {
        field: 'pricePaise',
        code: price.code,
      });
    }
  }

  return deps.uow.transaction(async (store) => {
    const current = new Map((await store.loadPlans(deps.actor.gymId)).map((plan) => [plan.code, plan.pricePaise]));

    const before: Record<string, number> = {};
    const after: Record<string, number> = {};
    for (const price of input.prices) {
      const was = current.get(price.code);
      if (was === undefined) throw new DomainError('NOT_FOUND', 'No such plan', { code: price.code });
      if (was !== price.pricePaise) {
        before[price.code] = was;
        after[price.code] = price.pricePaise;
      }
    }

    const changed = Object.entries(after);
    for (const [code, pricePaise] of changed) await store.savePlanPrice(deps.actor.gymId, code, pricePaise);
    if (changed.length > 0) {
      await store.writeAudit({
        gymId: deps.actor.gymId,
        actorType: 'staff',
        actorId: deps.actor.staffUserId,
        action: 'plans.price',
        entityType: 'Plan',
        entityId: null,
        before,
        after,
      });
    }
    return { changed: changed.length };
  });
}

// ── Gym settings ────────────────────────────────────────────────────────────

/** The groups, and the fields within them, this screen may change. Anything else is refused. */
const MANAGED_FIELDS = {
  pricing: ['admissionFeePaise'],
  privacy: ['minAge'],
  promo: ['enabled', 'textEn', 'textHi'],
  trust: ['googleRating', 'googleReviews', 'justdialRating', 'justdialReviews', 'establishedYear'],
  hours: null,
} as const;

type ManagedGroup = keyof typeof MANAGED_FIELDS;
const MANAGED_GROUPS = Object.keys(MANAGED_FIELDS) as ManagedGroup[];

export interface SettingsPatch {
  readonly pricing?: { readonly admissionFeePaise?: number };
  readonly privacy?: { readonly minAge?: number };
  readonly promo?: { readonly enabled?: boolean; readonly textEn?: string; readonly textHi?: string };
  readonly trust?: {
    readonly googleRating?: number;
    readonly googleReviews?: number;
    readonly justdialRating?: number;
    readonly justdialReviews?: number;
    readonly establishedYear?: number;
  };
  /** The whole week, replacing what is there. */
  readonly hours?: ReadonlyArray<{ readonly day: number; readonly open: string; readonly close: string; readonly closed: boolean }>;
}

const refuse = (field: string) => new DomainError('VALIDATION_FAILED', `The setting "${field}" cannot be changed here`, { field });

function assertOnlyManaged(patch: SettingsPatch): void {
  for (const [group, value] of Object.entries(patch)) {
    if (!(group in MANAGED_FIELDS)) throw refuse(group);
    const fields = MANAGED_FIELDS[group as ManagedGroup];
    if (fields === null || value === undefined) continue;
    for (const field of Object.keys(value as object)) {
      if (!(fields as readonly string[]).includes(field)) throw refuse(`${group}.${field}`);
    }
  }
}

export async function updateGymSettings(
  input: { readonly patch: SettingsPatch },
  deps: SettingsDeps,
): Promise<{ readonly changedGroups: readonly ManagedGroup[] }> {
  assertCan(deps.actor, 'settings.manage', deps.clock.now());
  assertOnlyManaged(input.patch);

  const fee = input.patch.pricing?.admissionFeePaise;
  if (fee !== undefined && !isWholeRupees(fee)) {
    throw new DomainError('VALIDATION_FAILED', 'The admission fee is set in whole rupees', { field: 'pricing.admissionFeePaise' });
  }

  return deps.uow.transaction(async (store) => {
    const stored = GymSettingsSchema.safeParse(await store.loadSettings(deps.actor.gymId));
    if (!stored.success) throw new DomainError('CONFLICT', 'The stored settings are not valid; fix them before editing');
    const current = stored.data;

    const { patch } = input;
    const merged = GymSettingsSchema.safeParse({
      ...current,
      pricing: { ...current.pricing, ...patch.pricing },
      privacy: { ...current.privacy, ...patch.privacy },
      promo: { ...current.promo, ...patch.promo },
      trust: { ...current.trust, ...patch.trust },
      hours: patch.hours ?? current.hours,
    });
    if (!merged.success) {
      const issue = merged.error.issues[0];
      throw new DomainError('VALIDATION_FAILED', issue?.message ?? 'Settings are not valid', { field: issue?.path.join('.') ?? '' });
    }
    const next = merged.data;

    const changedGroups = MANAGED_GROUPS.filter((group) => patch[group] !== undefined && JSON.stringify(current[group]) !== JSON.stringify(next[group]));
    if (changedGroups.length === 0) return { changedGroups };

    await store.saveSettings(deps.actor.gymId, next);
    await store.writeAudit({
      gymId: deps.actor.gymId,
      actorType: 'staff',
      actorId: deps.actor.staffUserId,
      action: 'settings.update',
      entityType: 'Gym',
      entityId: deps.actor.gymId,
      before: Object.fromEntries(changedGroups.map((group) => [group, current[group]])),
      after: Object.fromEntries(changedGroups.map((group) => [group, next[group]])),
    });
    return { changedGroups };
  });
}
