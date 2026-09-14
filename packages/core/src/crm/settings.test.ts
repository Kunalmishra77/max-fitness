import { beforeEach, describe, expect, it } from 'vitest';
import { defaultGymSettings, type GymSettings } from '@mfp/shared';
import { fakeClockAt } from '../testing/builders';
import type { CrmActor } from './permissions';
import { updateGymSettings, updatePlanPrices, type SettingsAuditEntry, type SettingsStore } from './settings';

/**
 * The owner's settings (crm-ux-blueprint §14; crm-module-spec §3).
 *
 * Prices, the joining rules, the website's promo and trust numbers, and opening hours.
 * All of it needs the owner **and** a PIN entered in the last few minutes, because a
 * phone left unlocked on the desk must not be able to change what the gym charges.
 * Every change is validated by the same schema the rest of the app reads settings
 * with, recorded in the audit log with its before and after, and a save that changes
 * nothing writes nothing.
 */

const clock = fakeClockAt('2026-09-14T11:00');
const owner: CrmActor = {
  staffUserId: 'staff_1',
  gymId: 'gym_1',
  role: 'OWNER',
  elevatedUntil: new Date(clock.now().getTime() + 60_000),
  receptionMayTakePayments: true,
};
const ownerWithoutPin: CrmActor = { ...owner, elevatedUntil: null };
const reception: CrmActor = { ...owner, staffUserId: 'staff_2', role: 'RECEPTION' };

class FakeStore implements SettingsStore {
  settings: unknown = defaultGymSettings();
  plans = [
    { code: 'M1_MALE', pricePaise: 150_000 },
    { code: 'M3_MALE', pricePaise: 400_000 },
  ];
  readonly saved: GymSettings[] = [];
  readonly prices: Array<{ code: string; pricePaise: number }> = [];
  readonly audit: SettingsAuditEntry[] = [];

  loadSettings() {
    return Promise.resolve(this.settings);
  }
  saveSettings(_gymId: string, settings: GymSettings) {
    this.saved.push(settings);
    return Promise.resolve();
  }
  loadPlans() {
    return Promise.resolve(this.plans);
  }
  savePlanPrice(_gymId: string, code: string, pricePaise: number) {
    this.prices.push({ code, pricePaise });
    return Promise.resolve();
  }
  writeAudit(entry: SettingsAuditEntry) {
    this.audit.push(entry);
    return Promise.resolve();
  }
}

describe('updatePlanPrices', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  const save = (prices: Array<{ code: string; pricePaise: number }>, actor: CrmActor = owner) =>
    updatePlanPrices({ prices }, { actor, clock, uow: { transaction: (work) => work(store) } });

  it('writes only the prices that changed, and records what they were', async () => {
    await expect(
      save([
        { code: 'M1_MALE', pricePaise: 160_000 },
        { code: 'M3_MALE', pricePaise: 400_000 },
      ]),
    ).resolves.toEqual({ changed: 1 });

    expect(store.prices).toEqual([{ code: 'M1_MALE', pricePaise: 160_000 }]);
    expect(store.audit).toEqual([
      {
        gymId: 'gym_1',
        actorType: 'staff',
        actorId: 'staff_1',
        action: 'plans.price',
        entityType: 'Plan',
        entityId: null,
        before: { M1_MALE: 150_000 },
        after: { M1_MALE: 160_000 },
      },
    ]);
  });

  it('writes and records nothing when no price changed', async () => {
    await expect(save([{ code: 'M1_MALE', pricePaise: 150_000 }])).resolves.toEqual({ changed: 0 });
    expect(store.prices).toEqual([]);
    expect(store.audit).toEqual([]);
  });

  it('refuses a price in paise rather than whole rupees, a free plan, and an absurd one', async () => {
    await expect(save([{ code: 'M1_MALE', pricePaise: 150_050 }])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(save([{ code: 'M1_MALE', pricePaise: 0 }])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(save([{ code: 'M1_MALE', pricePaise: 10_000_100 }])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(store.prices).toEqual([]);
  });

  it('refuses a plan the gym does not have', async () => {
    await expect(save([{ code: 'M24_MALE', pricePaise: 200_000 }])).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('needs the owner, with a PIN entered a moment ago', async () => {
    await expect(save([{ code: 'M1_MALE', pricePaise: 160_000 }], ownerWithoutPin)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(save([{ code: 'M1_MALE', pricePaise: 160_000 }], reception)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(store.prices).toEqual([]);
  });
});

describe('updateGymSettings', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  const save = (patch: Parameters<typeof updateGymSettings>[0]['patch'], actor: CrmActor = owner) =>
    updateGymSettings({ patch }, { actor, clock, uow: { transaction: (work) => work(store) } });

  it('sets the admission fee and the minimum age, and leaves every other setting as it was', async () => {
    await expect(save({ pricing: { admissionFeePaise: 50_000 }, privacy: { minAge: 18 } })).resolves.toEqual({
      changedGroups: ['pricing', 'privacy'],
    });

    const [saved] = store.saved;
    expect(saved?.pricing).toMatchObject({ admissionFeePaise: 50_000, allowDeskDiscounts: true });
    expect(saved?.privacy).toMatchObject({ minAge: 18, privacyNoticeVersion: '1.0' });
    expect(saved?.features).toEqual(defaultGymSettings().features);

    expect(store.audit).toHaveLength(1);
    expect(store.audit[0]).toMatchObject({
      action: 'settings.update',
      entityType: 'Gym',
      entityId: 'gym_1',
      before: { pricing: { admissionFeePaise: 0 }, privacy: { minAge: 16 } },
      after: { pricing: { admissionFeePaise: 50_000 }, privacy: { minAge: 18 } },
    });
  });

  it('updates the website promo and trust numbers, merging into what is there', async () => {
    await save({ promo: { enabled: true, textHi: 'नया ऑफर', textEn: 'New offer' }, trust: { googleReviews: 250 } });

    const [saved] = store.saved;
    expect(saved?.promo).toMatchObject({ enabled: true, textHi: 'नया ऑफर', textEn: 'New offer', barEnabled: false });
    expect(saved?.trust).toMatchObject({ googleReviews: 250, googleRating: 4.8 });
  });

  it('replaces the opening hours as a whole week, and refuses a time that is not a time', async () => {
    const week = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '05:00', close: '22:00', closed: day === 0 }));
    await save({ hours: week });
    expect(store.saved[0]?.hours).toHaveLength(7);
    expect(store.saved[0]?.hours[1]).toMatchObject({ day: 1, open: '05:00', close: '22:00', closed: false });

    await expect(save({ hours: [{ day: 1, open: '25:00', close: '22:00', closed: false }] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses an admission fee in paise and a minimum age the rules do not allow', async () => {
    await expect(save({ pricing: { admissionFeePaise: 50_050 } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(save({ privacy: { minAge: 10 } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(store.saved).toEqual([]);
  });

  it('refuses settings this screen does not manage, so a feature flag cannot be flipped from here', async () => {
    await expect(save({ features: { kioskShadowMode: false } } as never)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(store.saved).toEqual([]);
  });

  it('writes and records nothing when nothing changed', async () => {
    await expect(save({ privacy: { minAge: 16 } })).resolves.toEqual({ changedGroups: [] });
    expect(store.saved).toEqual([]);
    expect(store.audit).toEqual([]);
  });

  it('needs the owner, with a PIN entered a moment ago', async () => {
    await expect(save({ privacy: { minAge: 18 } }, ownerWithoutPin)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(save({ privacy: { minAge: 18 } }, reception)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
