// D-NEARNESS-LADDER-HYBRID-01 (decision C2) — the per-player "held" overlay.
//
// Which near rungs are SAFE to serve this player? The rungs themselves are global
// (DomainRelation); "held" is per-player and derived from data we already hold —
// no LLM call. A rung counts as held when the player has ANSWERED IT CORRECTLY
// (live or catch-up) or ACTIVELY DECLARED it. The caller ORs this with the
// in-scope territory map (playerMastery), completing the C2 set:
//   territory ∪ answer-history ∪ declared-interest.
//
// Returns FOLDED domain keys (domainKey) so a near-rung label compares correctly
// against differently-punctuated stored strings. Free DB reads; fails open to an
// empty set at the call site.
import { and, eq, inArray } from 'drizzle-orm';

import { db, declaredInterests, masteryEvents } from '@/server/db';
import { domainKey } from '@/lib/knowledge/domain-key';

// Correct-answer mastery event sources (the "demonstrated footing" signal).
const CORRECT_SOURCE_TYPES = ['live_correct', 'catchup_correct'] as const;

export async function getHeldDomainKeys(userId: string): Promise<Set<string>> {
  const [answered, declared] = await Promise.all([
    db
      .selectDistinct({ domain: masteryEvents.canonicalSubcategory })
      .from(masteryEvents)
      .where(and(
        eq(masteryEvents.userId, userId),
        inArray(masteryEvents.sourceType, [...CORRECT_SOURCE_TYPES]),
      )),
    db
      .select({ domain: declaredInterests.domain })
      .from(declaredInterests)
      .where(and(
        eq(declaredInterests.userId, userId),
        eq(declaredInterests.isActive, true),
      )),
  ]);

  const keys = new Set<string>();
  for (const row of answered) if (row.domain) keys.add(domainKey(row.domain));
  for (const row of declared) if (row.domain) keys.add(domainKey(row.domain));
  return keys;
}
