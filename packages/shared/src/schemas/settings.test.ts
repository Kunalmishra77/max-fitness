import { describe, expect, it } from 'vitest';
import {
  GymSettingsSchema,
  QuietHoursViolationError,
  assertSlotsWithinQuietHours,
  defaultGymSettings,
  slotsOutsideQuietHours,
} from './settings';
import { istTime } from '../time/ist-date';

describe('defaultGymSettings — every ⚙ default from business-rules.md', () => {
  const s = defaultGymSettings();

  it('uses the Hindi-first default for the CRM (CLAUDE.md §2.9)', () => {
    expect(s.defaultLanguage).toBe('hi');
  });

  it('lets reception take fees by default, as a setting of its own (crm-module-spec §3)', () => {
    expect(GymSettingsSchema.parse({}).pricing.receptionMayTakePayments).toBe(true);
    // Separate from discounts: switching one off must not switch the other off.
    const noReceptionFees = GymSettingsSchema.parse({ pricing: { receptionMayTakePayments: false } });
    expect(noReceptionFees.pricing).toMatchObject({ receptionMayTakePayments: false, allowDeskDiscounts: true });
  });

  it('matches the pricing defaults', () => {
    expect(s.pricing.admissionFeePaise).toBe(0); // BR-2.6
    expect(s.pricing.otherGenderPricing).toBe('ASK_AT_DESK'); // BR-2.5
    expect(s.pricing.allowPartialPayments).toBe(false); // BR-11.1
  });

  it('matches the membership defaults', () => {
    expect(s.membership.maxStartDateDaysAhead).toBe(15); // BR-3.3
    expect(s.membership.renewalGraceDays).toBe(5); // BR-3.4
    expect(s.membership.autoLeftAfterDays).toBe(60); // BR-4.3
  });

  it('matches the reminder defaults', () => {
    expect(s.reminders.quietHours).toEqual({ start: '08:00', end: '21:00' }); // BR-5.3
    expect(s.reminders.postExpiryMaxDays).toBe(7); // BR-5.2
    expect(s.reminders.restartWindowDays).toBe(7); // BR-6.4
  });

  it('matches the attendance defaults', () => {
    expect(s.attendance.checkInCooldownMinutes).toBe(180); // BR-9.1
    expect(s.attendance.absentDaysThreshold).toBe(7); // BR-7
    expect(s.attendance.kioskOfflineAlertMinutes).toBe(30);
  });

  it('matches the privacy defaults', () => {
    expect(s.privacy.minAge).toBe(16); // BR-12.2
    expect(s.privacy.faceDeleteAfterLeftDays).toBe(30); // BR-6.6
  });

  it('matches the feature flags', () => {
    expect(s.features.otpRequired).toBe(false);
    expect(s.features.autoBirthdayWish).toBe(false); // BR-8.2
    expect(s.features.kioskShadowMode).toBe(true); // seed spec §2
  });

  it('carries the trust numbers from the Google and Justdial listings', () => {
    expect(s.trust).toMatchObject({
      googleRating: 4.8,
      googleReviews: 231,
      justdialRating: 4.9,
      justdialReviews: 262,
      establishedYear: 2000,
    });
  });

  it('starts with the promo banner and the announcement bar off', () => {
    expect(s.promo.enabled).toBe(false);
    expect(s.promo.barEnabled).toBe(false);
  });

  it('keeps settings saved before the bar existed valid (ADR-024)', () => {
    const legacy = GymSettingsSchema.parse({ promo: { enabled: true, textEn: 'Offer', textHi: 'ऑफर' } });
    expect(legacy.promo).toMatchObject({ enabled: true, textEn: 'Offer', barEnabled: false, barTextEn: '' });
  });

  it('caps the bar text shorter than the banner', () => {
    expect(() => GymSettingsSchema.parse({ promo: { barTextEn: 'x'.repeat(91) } })).toThrow();
  });
});

describe('GymSettingsSchema — validation', () => {
  it('accepts a partial object and fills in the rest', () => {
    const s = GymSettingsSchema.parse({ pricing: { admissionFeePaise: 50_000 } });
    expect(s.pricing.admissionFeePaise).toBe(50_000);
    expect(s.pricing.otherGenderPricing).toBe('ASK_AT_DESK');
    expect(s.membership.renewalGraceDays).toBe(5);
  });

  it('rejects a negative admission fee', () => {
    expect(() => GymSettingsSchema.parse({ pricing: { admissionFeePaise: -1 } })).toThrow();
  });

  it('rejects a non-integer admission fee — money is paise', () => {
    expect(() => GymSettingsSchema.parse({ pricing: { admissionFeePaise: 500.5 } })).toThrow();
  });

  it('allows an uncapped post-expiry window but not a zero one', () => {
    expect(GymSettingsSchema.parse({ reminders: { postExpiryMaxDays: null } }).reminders.postExpiryMaxDays).toBeNull();
    expect(() => GymSettingsSchema.parse({ reminders: { postExpiryMaxDays: 0 } })).toThrow();
    expect(() => GymSettingsSchema.parse({ reminders: { postExpiryMaxDays: 61 } })).toThrow();
  });

  it('rejects a malformed time of day', () => {
    expect(() => GymSettingsSchema.parse({ reminders: { quietHours: { start: '8:00', end: '21:00' } } })).toThrow();
    expect(() => GymSettingsSchema.parse({ reminders: { quietHours: { start: '08:00', end: '25:00' } } })).toThrow();
  });

  it('rejects quiet hours that end before they start', () => {
    expect(() =>
      GymSettingsSchema.parse({ reminders: { quietHours: { start: '21:00', end: '08:00' } } }),
    ).toThrow();
  });

  it('rejects a minimum age outside a sane band', () => {
    expect(() => GymSettingsSchema.parse({ privacy: { minAge: 8 } })).toThrow();
    expect(() => GymSettingsSchema.parse({ privacy: { minAge: 40 } })).toThrow();
  });

  it('accepts gym opening hours', () => {
    const s = GymSettingsSchema.parse({
      hours: [
        { day: 1, open: '05:00', close: '22:00' },
        { day: 0, open: '06:00', close: '11:00', closed: false },
      ],
    });
    expect(s.hours).toHaveLength(2);
    expect(s.hours[0]?.closed).toBe(false);
  });

  it('rejects an out-of-range weekday', () => {
    expect(() => GymSettingsSchema.parse({ hours: [{ day: 7, open: '05:00', close: '22:00' }] })).toThrow();
  });
});

describe('quiet-hours validation for reminder slots — case R18', () => {
  const quietHours = { start: istTime('08:00'), end: istTime('21:00') };

  it('accepts the default BR-5.1 slots', () => {
    expect(slotsOutsideQuietHours(['09:30', '10:00', '14:00', '19:00'], quietHours)).toEqual([]);
    expect(() => assertSlotsWithinQuietHours(['09:30', '10:00', '14:00', '19:00'], quietHours)).not.toThrow();
  });

  it('rejects a slot after quiet hours end — R18', () => {
    expect(slotsOutsideQuietHours(['22:00'], quietHours)).toEqual(['22:00']);
    expect(() => assertSlotsWithinQuietHours(['10:00', '22:00'], quietHours)).toThrow(QuietHoursViolationError);
  });

  it('rejects a slot before quiet hours begin', () => {
    expect(slotsOutsideQuietHours(['06:00'], quietHours)).toEqual(['06:00']);
  });

  it('accepts the boundaries themselves', () => {
    expect(slotsOutsideQuietHours(['08:00', '21:00'], quietHours)).toEqual([]);
  });

  it('treats an unparseable slot as a violation rather than letting it through', () => {
    expect(slotsOutsideQuietHours(['nonsense'], quietHours)).toEqual(['nonsense']);
  });

  it('names every offending slot in the error', () => {
    try {
      assertSlotsWithinQuietHours(['06:00', '10:00', '23:30'], quietHours);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(QuietHoursViolationError);
      expect((error as QuietHoursViolationError).slots).toEqual(['06:00', '23:30']);
      expect((error as Error).message).toContain('BR-5.3');
    }
  });
});
