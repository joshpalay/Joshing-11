/**
 * Mastery v2 (docs/thinking/MASTERY-MODEL-v2.md) — Phase 3: the PURE recompute
 * engine.
 *
 * Spec decision 1: mastery is a PROJECTION of (a player's answer events × the
 * CURRENT taxonomy), not a movable ledger. MASTERY_EVENTS is the immutable truth;
 * PLAYER_MASTERY is a rebuildable cache. This function is that projection — given
 * the raw events and a resolver from questionId → the question's CURRENT domain,
 * it produces the per-(user, domain) point totals and tier.
 *
 * Re-bucketing rule (Phase 0: ~12.5% of events need the fallback):
 *   - question_id present AND it resolves → the question's CURRENT domain.
 *   - else (null question_id — bot/personal-daily, domain_merged bookkeeping — or
 *     an unresolvable id) → the event's STORED canonical_subcategory snapshot.
 *
 * Grouping folds via domainKey to match how the live write path converges
 * same-key territories (resolveToExistingTerritory). Tier uses effectiveTier so
 * the author-credit gate on Mastery is reproduced. Pure and deterministic — no
 * I/O; the resolver is injected, so it is unit-tested without a DB.
 */

import type { MasteryTier } from '@/types/db';
import { effectiveTier } from '@/server/mastery/tiers';
import { domainKey } from '@/lib/knowledge/domain-key';

/** The subset of a MASTERY_EVENTS row the projection needs. */
export type MasteryEventInput = {
  userId: string;
  /** The domain snapshot stored on the event at write time — the fallback bucket. */
  canonicalSubcategory: string;
  questionId: string | null;
  /** masterySourceTypeEnum value; only 'author_credit' affects the tier gate. */
  sourceType: string;
  awardedPoints: number;
};

export type RecomputedDomain = {
  userId: string;
  /** The folded lookup key the row is grouped under. */
  domainKey: string;
  /** A display label for the domain (the current domain the points landed in). */
  canonicalSubcategory: string;
  totalPoints: number;
  authorCreditPoints: number;
  authorCreditDistinctQuestions: number;
  tier: MasteryTier;
  eventCount: number;
};

const AUTHOR_CREDIT = 'author_credit';

// Bucket separator. UserIds are space-free (cuid/uuid), so a space cannot create
// an ambiguous split against the folded domainKey that follows it.
const BUCKET_SEP = ' ';

/**
 * The map key recomputeMastery groups by: a (user, folded-domain) pair. Exported
 * so every caller — and the validation script — builds the SAME key from a raw
 * domain label; the domainKey fold happens here, once.
 */
export function masteryBucketKey(userId: string, domainLabel: string): string {
  return `${userId}${BUCKET_SEP}${domainKey(domainLabel)}`;
}

/**
 * Project the events onto the current taxonomy. `resolveDomain(questionId)`
 * returns the question's CURRENT domain label, or null when the id is unknown
 * (then the event's stored snapshot stands). Returns one entry per
 * (user, folded-domain), keyed by masteryBucketKey(userId, domain).
 */
export function recomputeMastery(
  events: readonly MasteryEventInput[],
  resolveDomain: (questionId: string) => string | null,
): Map<string, RecomputedDomain> {
  const out = new Map<string, RecomputedDomain>();
  const authorQuestionsByBucket = new Map<string, Set<string>>();

  for (const event of events) {
    // Re-bucket by the question's current domain; fall back to the stored snapshot.
    let domain = event.canonicalSubcategory;
    if (event.questionId) {
      const resolved = resolveDomain(event.questionId);
      if (resolved && resolved.trim()) domain = resolved;
    }
    const bucket = masteryBucketKey(event.userId, domain);

    let entry = out.get(bucket);
    if (!entry) {
      entry = {
        userId: event.userId,
        domainKey: domainKey(domain),
        canonicalSubcategory: domain,
        totalPoints: 0,
        authorCreditPoints: 0,
        authorCreditDistinctQuestions: 0,
        tier: 'establishing',
        eventCount: 0,
      };
      out.set(bucket, entry);
    }

    const points = Number.isFinite(event.awardedPoints) ? event.awardedPoints : 0;
    entry.totalPoints += points;
    entry.eventCount += 1;
    if (event.sourceType === AUTHOR_CREDIT) {
      entry.authorCreditPoints += points;
      if (event.questionId) {
        let set = authorQuestionsByBucket.get(bucket);
        if (!set) {
          set = new Set<string>();
          authorQuestionsByBucket.set(bucket, set);
        }
        set.add(event.questionId);
      }
    }
  }

  for (const [bucket, entry] of out) {
    entry.authorCreditDistinctQuestions = authorQuestionsByBucket.get(bucket)?.size ?? 0;
    entry.tier = effectiveTier(
      entry.totalPoints,
      entry.authorCreditPoints,
      entry.authorCreditDistinctQuestions,
    );
  }

  return out;
}
