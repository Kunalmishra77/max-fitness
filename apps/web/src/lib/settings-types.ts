/**
 * What the settings screen's server actions answer (crm-ux-blueprint §14).
 *
 * Kept apart from the actions file, which may export only async functions, and from the
 * client forms, so both sides import one definition.
 */

export type SettingsResult =
  | { ok: true; changed: boolean }
  | { ok: false; code: 'PIN_REQUIRED' | 'FORBIDDEN' | 'VALIDATION_FAILED' | 'generic'; field?: string };

export type UnlockResult = { ok: true } | { ok: false; code: 'INVALID_PIN' | 'ACCOUNT_LOCKED' | 'FORBIDDEN' | 'INTERNAL' };

export interface PriceInput {
  readonly code: string;
  readonly pricePaise: number;
}

export interface HoursInput {
  readonly day: number;
  readonly open: string;
  readonly close: string;
  readonly closed: boolean;
}

export interface SettingsPatchInput {
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
  readonly hours?: readonly HoursInput[];
}
