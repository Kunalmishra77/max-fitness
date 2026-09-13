/**
 * Lead-form constants without Zod.
 *
 * The landing page's call-back form renders from these and loads the full schema
 * (`./lead`, which pulls in Zod) only when someone starts filling it in, so the page's
 * first load stays light (ADR-033). `./lead` re-exports everything here.
 */

/** The goals offered in the form (copy deck: Lose weight, Build muscle, Get fit and active, Strength training, Other). */
export const LEAD_GOALS = ['LOSE_WEIGHT', 'BUILD_MUSCLE', 'GET_FIT', 'STRENGTH', 'OTHER'] as const;
export type LeadGoal = (typeof LEAD_GOALS)[number];

/** Sources a public form may claim. Everything else (walk-in, phone, GBP…) is recorded by staff. */
export const PUBLIC_LEAD_SOURCES = ['WEBSITE_HERO', 'WEBSITE_OTHER'] as const;
export type PublicLeadSource = (typeof PUBLIC_LEAD_SOURCES)[number];

/** Validation codes; each maps to `lead.errors.<code>` in messages/{en,hi}.json. */
export const LEAD_ERROR_CODES = ['name', 'mobile', 'goal', 'consent'] as const;
export type LeadErrorCode = (typeof LEAD_ERROR_CODES)[number];
