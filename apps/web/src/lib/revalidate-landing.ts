import { revalidateTag } from 'next/cache';
import { LANDING_TAGS } from './landing-data';

/**
 * Refresh the public site after the owner changes prices, promo, hours or trust
 * numbers (PRD LP-02, LP-05, LP-09, LP-11; ADR-022).
 *
 * Called from CRM server actions (Phase 4). There is deliberately no public HTTP
 * route for this: anyone able to hit it could keep the cache permanently cold.
 * Next 16's `revalidateTag` takes a cache profile; `'max'` marks entries stale so the
 * next visitor gets fresh data.
 */
export function revalidateLandingContent(): void {
  for (const tag of LANDING_TAGS) {
    revalidateTag(tag, 'max');
  }
}
