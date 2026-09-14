import { updateTag } from 'next/cache';
import { LANDING_TAGS } from './landing-data';

/**
 * Refresh the public site after the owner changes prices, promo, hours or trust
 * numbers (PRD LP-02, LP-05, LP-09, LP-11; ADR-022, ADR-047).
 *
 * Called only from CRM server actions. There is deliberately no public HTTP route for
 * this: anyone able to hit it could keep the cache permanently cold.
 *
 * `updateTag` expires the cached entries at once, so an owner who saves an offer and
 * opens the website sees it on that very load. The earlier `revalidateTag(tag, 'max')`
 * is stale-while-revalidate: the first visitor after a save still got the old page,
 * which is exactly the owner checking their change — found by the settings end-to-end
 * test. `updateTag` may only be called from a Server Action, which is the only caller.
 */
export function revalidateLandingContent(): void {
  for (const tag of LANDING_TAGS) {
    updateTag(tag);
  }
}
