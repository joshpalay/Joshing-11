/**
 * Refine Your Game — selection (pure).
 *
 * Drop anything in cooldown, order by priority, keep the top three.
 */

import { REFINE_MAX_ITEMS, REFINE_PRIORITY, refineItemKey, type RefineCandidate } from './types';

export function selectRefineCandidates(
  candidates: RefineCandidate[],
  activeCooldowns: Set<string>,
): RefineCandidate[] {
  return candidates
    .filter((c) => !activeCooldowns.has(refineItemKey(c.type, c.subdomainId, c.friendId)))
    .sort((a, b) => REFINE_PRIORITY[a.type] - REFINE_PRIORITY[b.type])
    .slice(0, REFINE_MAX_ITEMS);
}
