import { compareISTDates, isISTDate, type ISTDate, type Language } from '@mfp/shared';

/**
 * Which promotions show today (PRD LP-02, LP-11; ADR-024).
 *
 * The owner edits promo text and an optional date window from the CRM. The rules are
 * deliberately forgiving about data and strict about display: a promo with no text in
 * the visitor's language falls back to the other language, a promo with no text at
 * all never renders an empty coloured bar, and a malformed date is ignored rather
 * than hiding the offer.
 */

export interface PromoSettingsInput {
  readonly enabled: boolean;
  readonly textEn: string;
  readonly textHi: string;
  readonly barEnabled: boolean;
  readonly barTextEn: string;
  readonly barTextHi: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
}

export interface ActivePromos {
  /** Announcement bar text, or `null` when hidden. */
  readonly bar: string | null;
  /** Mid-page banner text, or `null` when hidden. */
  readonly banner: string | null;
}

/** Inside the optional window, inclusive at both ends (IST calendar dates). */
export function isWithinPromoWindow(today: ISTDate, startDate: string | null, endDate: string | null): boolean {
  if (startDate !== null && isISTDate(startDate) && compareISTDates(today, startDate) < 0) return false;
  if (endDate !== null && isISTDate(endDate) && compareISTDates(today, endDate) > 0) return false;
  return true;
}

function pick(language: Language, en: string, hi: string): string | null {
  const preferred = (language === 'hi' ? hi : en).trim();
  const fallback = (language === 'hi' ? en : hi).trim();
  const text = preferred !== '' ? preferred : fallback;
  return text === '' ? null : text;
}

export function activePromos(promo: PromoSettingsInput, today: ISTDate, language: Language): ActivePromos {
  if (!isWithinPromoWindow(today, promo.startDate, promo.endDate)) {
    return { bar: null, banner: null };
  }
  return {
    bar: promo.barEnabled ? pick(language, promo.barTextEn, promo.barTextHi) : null,
    banner: promo.enabled ? pick(language, promo.textEn, promo.textHi) : null,
  };
}
