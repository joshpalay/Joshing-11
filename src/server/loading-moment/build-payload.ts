/**
 * Server-side producer for the Loading Moment payload (B-LOADING-MOMENT-01).
 *
 * This runs OFF the loading critical path — it is called by /api/loading-moment,
 * which the client primes from a stable screen (e.g. the home page), never from
 * the loading screen itself. The loader only ever reads the cached result
 * synchronously, so this producer's queries never add latency to a load (C-1/C-3).
 *
 * Truth gate (C-2): a card field is populated ONLY when its underlying fact is
 * real and current. When a fact isn't cleanly + truthfully derivable, the field
 * is left undefined and the selector falls through the ladder — never a
 * fabricated or "approximate" stat.
 *
 * Card coverage this build:
 *  - Card 1 (deepest territory): populated from PLAYER_MASTERY via the existing
 *    mastery overview.
 *  - Cards 2–6: deferred. Card 2 (rare knowledge) has no rarity signal in the
 *    model yet; overlap is pairwise-only (no cheap "any friend" read); the
 *    turnaround, deepest-cut and waiting-discovery sources need dedicated reads
 *    that are out of scope for this first wiring. The selector already tolerates
 *    their absence, so a later build can light them up by populating the payload.
 */

import { getUserMasteryOverview } from '@/server/db/queries/knowledge';
import type { LoadingMomentPayload } from '@/components/loading-moment/types';

// The portrait threshold: a domain only reads as "your deepest territory" once
// the player has genuinely demonstrated it. `isDemonstrated` already means they
// answered correctly on a live surface; requiring a few answered questions on
// top keeps the identity claim honest for a barely-touched domain.
const MIN_PORTRAIT_QUESTIONS = 3;

/**
 * Assemble the cached Loading Moment payload for a user. `now` is injectable for
 * tests; in production it stamps the payload's freshness (the selector rejects a
 * stale payload).
 */
export async function buildLoadingMomentPayload(
  userId: string,
  now: number = Date.now(),
): Promise<LoadingMomentPayload> {
  const payload: LoadingMomentPayload = { generatedAt: now };

  const overview = await getUserMasteryOverview(userId);

  // Domains are returned sorted by points desc; the first that clears the
  // portrait threshold (demonstrated, not hidden, enough answered) is the
  // deepest territory. The fact is real by construction — no fabrication.
  const deepest = overview.domains.find(
    (d) =>
      d.isDemonstrated &&
      !d.isHidden &&
      d.points > 0 &&
      d.questionsAnswered >= MIN_PORTRAIT_QUESTIONS &&
      d.displayName.trim().length > 0,
  );
  if (deepest) {
    payload.deepestTerritory = { subcategory: deepest.displayName.trim() };
  }

  return payload;
}
