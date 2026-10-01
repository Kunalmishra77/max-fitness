/**
 * Landing-page content that is not settings and not copy.
 *
 * Copy lives in messages/{en,hi}.json. Prices, hours, trust numbers and promo live in
 * Gym.settings. What remains here is content with a source to cite — reviews, the owner
 * quote, facility extras, FAQ answers — each carrying a flag, so the page can follow
 * one rule (PRD LP-07, LP-10, LP-12; Phase 2 decision 5):
 *
 *   production → show only confirmed content;
 *   demo / development → also show unconfirmed content, visibly labelled.
 *
 * Facts below were checked against the gym's Google Business Profile and its reviews on
 * 2026-09-11 (ADR-031). Confirming something else is a one-line change here (and later,
 * a CRM setting).
 */

export interface ReviewItem {
  readonly id: string;
  /** "Vineet D." — first name and initial only (copy deck). */
  readonly author: string;
  readonly rating: 1 | 2 | 3 | 4 | 5;
  /** Quoted exactly as written by the reviewer; an ellipsis marks a cut; ≤ 220 characters. */
  readonly text: string;
  readonly demo: boolean;
}

/**
 * Real Google reviews, star ratings checked on the listing (2026-09-11). Chosen to cover
 * what prospects ask about: equipment and cleanliness, value, space, personal training
 * and the owner's coaching.
 */
export const REAL_REVIEWS: readonly ReviewItem[] = [
  {
    id: 'google-gaurav',
    author: 'Gaurav',
    rating: 5,
    text: 'The environment is clean, motivating, and well-maintained, with modern equipment that makes every workout effective. The trainers are knowledgeable, friendly, and always ready to guide and support you.',
    demo: false,
  },
  {
    id: 'google-vineet-d',
    author: 'Vineet D.',
    rating: 5,
    text: 'It is a value for money gym. New gym equipment, all in working condition. All the options in terms of equipment are available.',
    demo: false,
  },
  {
    id: 'google-rohit-s',
    author: 'Rohit S.',
    rating: 5,
    text: 'Best part is they have separate area for cardio , trademill and other high intensity cardio and a separate area for other exercises.',
    demo: false,
  },
  {
    id: 'google-santosh-b',
    author: 'Santosh B.',
    rating: 5,
    text: 'Best experience Of mine about 6 months of gym Best trainer support Ajay bhaiya. Always supportive and motivating to people for Better fitness.',
    demo: false,
  },
  {
    id: 'google-akshay-d',
    author: 'Akshay D.',
    rating: 5,
    text: 'Best gym in indirapuram with very reasonable price. Personal training is also available at cheaper rates',
    demo: false,
  },
  {
    id: 'google-afzal-k',
    author: 'Afzal K.',
    rating: 5,
    text: 'The top gym in Indirapuram, offering affordable personal training options for all fitness enthusiasts.',
    demo: false,
  },
];

/** Copy deck demo placeholders — used only if there are no real reviews, and never in production. */
export const DEMO_REVIEWS: readonly ReviewItem[] = [
  {
    id: 'demo-a',
    author: 'Demo A.',
    rating: 5,
    text: 'Very helpful trainers. I had never been to a gym and they taught me everything patiently.',
    demo: true,
  },
  {
    id: 'demo-b',
    author: 'Demo B.',
    rating: 5,
    text: 'Good equipment and the owner personally corrects form. Worth the fee.',
    demo: true,
  },
];

/**
 * The owner section (LP-10). The quote is a member's Google review, word for word; the
 * section itself states only facts supported by the listing and reviews.
 */
export const OWNER_STORY = {
  quoteAuthor: 'Aadhar G.',
} as const;

/** The gym has no boxing corner — it was in the early wireframes and never existed (2026-09-25). */
export const FACILITY_ZONES = ['strength', 'cardio', 'functional'] as const;
export type FacilityZone = (typeof FACILITY_ZONES)[number];

/**
 * "Also here" items, every one of them confirmed by the owner (2026-10-01).
 *
 * A changing area is deliberately not listed: a 2025 review says there is none, and the
 * owner has not said otherwise. Nothing goes on this list the gym cannot show somebody.
 */
export const FACILITY_EXTRAS: ReadonlyArray<{
  readonly key: 'personalTraining' | 'dietPlans' | 'supplements' | 'lockers' | 'drinkingWater' | 'parking' | 'airConditioned';
  readonly confirmed: boolean;
}> = [
  { key: 'personalTraining', confirmed: true },
  { key: 'dietPlans', confirmed: true },
  // All confirmed by the owner on 2026-10-01, so nothing on the floor is a guess any
  // more: supplements at the counter, lockers, drinking water, parking and air
  // conditioning all exist.
  { key: 'supplements', confirmed: true },
  { key: 'lockers', confirmed: true },
  { key: 'drinkingWater', confirmed: true },
  { key: 'parking', confirmed: true },
  { key: 'airConditioned', confirmed: true },
];

export type FaqKey =
  | 'timings'
  | 'fees'
  | 'trial'
  | 'beginner'
  | 'women'
  | 'payment'
  | 'selfie'
  | 'pause'
  | 'refund'
  | 'bring'
  | 'personalTraining'
  | 'minAge';

/**
 * FAQ order from the copy deck. `verified: false` answers are owner placeholders or
 * unconfirmed claims; they are left out of the page and out of FAQPage structured data
 * in production — publishing an unconfirmed answer to Google would be worse than none.
 * Timings (settings match the Google listing) and personal training (the owner's own
 * note: ₹3,000 a month with a diet plan) were verified on 2026-09-11.
 */
export const FAQ_ITEMS: ReadonlyArray<{ readonly key: FaqKey; readonly verified: boolean }> = [
  { key: 'timings', verified: true },
  { key: 'fees', verified: true },
  { key: 'trial', verified: false },
  { key: 'beginner', verified: true },
  { key: 'women', verified: false },
  { key: 'payment', verified: true },
  { key: 'selfie', verified: true },
  { key: 'pause', verified: false },
  { key: 'refund', verified: false },
  { key: 'bring', verified: true },
  { key: 'personalTraining', verified: true },
  { key: 'minAge', verified: false },
];

/**
 * Whether unconfirmed content may appear, with its label (ADR-085).
 *
 * This used to follow `DEMO_MODE`, which was wrong once the gym went live: `DEMO_MODE`
 * is on because there is no payment gateway and no WhatsApp number yet, and that has
 * nothing to do with whether the gym has lockers. The gym's own members were reading
 * "DEMO" on the website while standing at its reception desk.
 *
 * So it is its own switch, off unless something sets it. Local development still shows
 * the labels, which is what they are for.
 */
export function showUnconfirmedContent(): boolean {
  if (process.env['SHOW_UNCONFIRMED_CONTENT'] === 'true') return true;
  return process.env['NODE_ENV'] !== 'production';
}
