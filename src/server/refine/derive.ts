/**
 * Refine Your Game — firing rules (pure).
 *
 * Each function takes already-loaded evidence (queue slots, precomputed miss
 * streaks) and returns candidates. No DB access — the reads live in
 * src/server/db/queries/refine.ts so these stay unit-testable.
 */

import type { QueueSlot } from '@/server/daily/types';
import { subdomainLabel } from './copy';
import {
  pruningThreshold,
  type RefineCandidate,
  type RefineMissTier,
} from './types';

/**
 * friend_expansion (priority 1): the player answered ≥1 question correctly from
 * a friend's bonus subdomain they don't own. Once is enough, deduped per
 * (subdomain, friend). A bonus slot is marked by `presence_source_id`.
 */
export function deriveFriendExpansion(
  slots: QueueSlot[],
  ownedLowercased: Set<string>,
): RefineCandidate[] {
  const byKey = new Map<string, RefineCandidate>();
  for (const slot of slots) {
    if (!slot.presence_source_id) continue; // not a bonus slot
    if (slot.answer_state !== 'correct') continue;
    const domain = slot.domain?.trim();
    if (!domain) continue;
    if (ownedLowercased.has(domain.toLowerCase())) continue; // already owned
    const friendId = slot.presence_source_id;
    const key = `${domain.toLowerCase()}:${friendId}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      type: 'friend_expansion',
      subdomainId: domain,
      subdomainLabel: subdomainLabel(domain),
      friendId,
      friendName: slot.presence_source_name ?? undefined,
    });
  }
  return [...byKey.values()];
}

/**
 * difficulty_escalation (priority 2): a subdomain's difficulty stepped up this
 * daily (`difficulty_stepped_up`). One candidate per subdomain. Escalation is
 * automatic, so this is an opt-out heads-up.
 */
export function deriveDifficultyEscalation(slots: QueueSlot[]): RefineCandidate[] {
  const byDomain = new Map<string, RefineCandidate>();
  for (const slot of slots) {
    if (slot.difficulty_stepped_up !== true) continue;
    const domain = slot.domain?.trim();
    if (!domain) continue;
    const key = domain.toLowerCase();
    if (byDomain.has(key)) continue;
    byDomain.set(key, {
      type: 'difficulty_escalation',
      subdomainId: domain,
      subdomainLabel: subdomainLabel(domain),
    });
  }
  return [...byDomain.values()];
}

/** A precomputed trailing consecutive-miss run for one subdomain. */
export interface MissStreak {
  subdomainId: string;
  subdomainLabel: string;
  /** Consecutive misses since the last correct answer (0 if the latest was correct). */
  count: number;
  /** Tier of the most recent miss in the run — selects the threshold. */
  latestMissTier: RefineMissTier;
}

/**
 * struggle_pruning (priority 3): consecutive misses reaching the tiered
 * threshold (3/4/5 by the latest miss's tier).
 */
export function deriveStrugglePruning(streaks: MissStreak[]): RefineCandidate[] {
  const out: RefineCandidate[] = [];
  for (const streak of streaks) {
    if (streak.count >= pruningThreshold(streak.latestMissTier)) {
      out.push({
        type: 'struggle_pruning',
        subdomainId: streak.subdomainId,
        subdomainLabel: streak.subdomainLabel,
        missCount: streak.count,
      });
    }
  }
  return out;
}
