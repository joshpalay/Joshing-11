/**
 * D-SUPPLY-FINITE-SET-01 P2 — set-completion detection.
 *
 * A domain is a finite completable SET (~the fan-salient questions it holds).
 * When a player has answered the whole set, they earn a durable DESIGNATION
 * (recognition only — no mechanical effect) and an AUTOMATIC invitation to
 * author more, which lights the already-built /invited trophy takeover.
 *
 * Completion is COVERAGE-based (Josh, 2026-07-05): the player has answered at
 * least as many DISTINCT questions as the set's size (not the raw answer-event
 * count — repeats/catch-up must not trophy a replay).
 *
 * The set SIZE is the topic's depth-derived target question count
 * (D-DIFFICULTY-SIZE-COMPLETION-01, Josh 2026-07-06): a thin topic reaches its
 * small size fast → trophy → graduate; a deep topic has a long runway and rarely
 * completes. This replaced the earlier "durable pool depth" stopgap (which sized
 * completion by whatever questions happened to exist rather than the topic's real
 * size). The old behaviour is still reachable via DEPTH_SIZED_COMPLETION_ENABLED=0
 * as a kill-switch; depth sizing also fails open to it.
 *
 * Fail-open and idempotent: a designation stamps once (guarded on
 * designated_at IS NULL) and the invitation's partial unique index makes a
 * re-fire a no-op, so an over-eager or repeated call is harmless; an error
 * never breaks the summary it runs inside.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, masteryEvents } from '@/server/db';
import { domainKey } from '@/lib/knowledge/domain-key';
import { getClusterContext, substantiveDescendants } from '@/server/knowledge/graph';
import { markDomainExpansionEligible } from '@/server/adaptive-difficulty';
import {
  hasDesignation,
  inviteToAuthorAutomatic,
  markDomainDesignated,
} from '@/server/db/queries/author-invitations';
import { getDurablePoolDepthForDomains } from '@/server/db/queries/retrieval-demand';
import {
  getTargetQuestionCountForDomains,
  minPossibleTargetCount,
} from '@/server/daily/domain-size';

// Below this many distinct facts a domain isn't a "set" worth a trophy — a
// thin domain a player exhausts is surfaced to the human via the crafter
// worklist instead (the P1 expensive/thin signal), not celebrated. Only binds
// when depth sizing is OFF; the depth path uses minPossibleTargetCount(). Tunable.
export const SET_COMPLETION_MIN_SIZE = 8;

function isDepthSizedCompletionEnabled(): boolean {
  const raw = process.env.DEPTH_SIZED_COMPLETION_ENABLED?.trim().toLowerCase();
  return !(raw === 'false' || raw === '0' || raw === 'no' || raw === 'off');
}

// Resolve each candidate domain's set SIZE: the depth-derived target count, or
// (kill-switch / on error) the legacy durable-pool-depth. Fail-open to the legacy
// path so a sizing outage can't silently stop every trophy from ever firing.
async function getSetSizesForDomains(domains: string[]): Promise<Map<string, number>> {
  if (!isDepthSizedCompletionEnabled()) {
    return getDurablePoolDepthForDomains(domains);
  }
  try {
    return await getTargetQuestionCountForDomains(domains);
  } catch (error) {
    console.warn('[set-completion] depth sizing failed; falling back to pool depth', {
      error: error instanceof Error ? error.message : String(error),
    });
    return getDurablePoolDepthForDomains(domains);
  }
}

/**
 * Pure completion predicate (unit-tested): a set is complete when it is at least
 * the floor size AND the player has answered every distinct question in it.
 */
export function isSetComplete(input: {
  distinctAnswered: number;
  setSize: number;
  minSize?: number;
}): boolean {
  const minSize = input.minSize ?? SET_COMPLETION_MIN_SIZE;
  return input.setSize >= minSize && input.distinctAnswered >= input.setSize;
}

// Distinct QUESTIONS a player has answered per domain (coverage) — deduped so
// a re-answered question counts once, matching the distinct-fact set size.
//
// GRAPH-AWARE (D-MASTERY-FINEST-NODE-01 §3/P4): when a requested domain is an
// authored KnowledgeNode with substantive descendants, its coverage counts
// distinct questions answered anywhere in the subtree — the numerator must
// aggregate over the same subtree the subtree-union set SIZE does
// (getTargetQuestionCountForDomains), or parents whose target grew to the
// union would become uncompletable. Mirrors getDurablePoolDepthForDomains'
// roll-up; with an empty graph (or on any graph fault) the exact-label counts
// are the whole answer, byte-identical to the pre-graph behavior.
async function distinctAnsweredByDomain(
  userId: string,
  domains: string[],
): Promise<Map<string, number>> {
  if (domains.length === 0) return new Map();
  const rows = await db
    .select({
      domain: masteryEvents.canonicalSubcategory,
      answered: sql<number>`count(distinct ${masteryEvents.questionId})::int`,
    })
    .from(masteryEvents)
    .where(
      and(
        eq(masteryEvents.answeredByUserId, userId),
        inArray(masteryEvents.canonicalSubcategory, domains),
      ),
    )
    .groupBy(masteryEvents.canonicalSubcategory);
  const result = new Map(
    rows.filter((r) => r.domain).map((r) => [r.domain as string, Number(r.answered)]),
  );

  try {
    const ctx = await getClusterContext();
    if (ctx.nodeKeys.size === 0 || ctx.edges.length === 0) return result;

    const descendantsByDomain = new Map<string, Set<string>>();
    for (const domain of domains) {
      const key = domainKey(domain);
      if (!ctx.nodeKeys.has(key)) continue;
      const descendants = substantiveDescendants(key, ctx.edges);
      if (descendants.size > 0) descendantsByDomain.set(domain, descendants);
    }
    if (descendantsByDomain.size === 0) return result;

    // Distinct (label, question) pairs across this player's whole answer
    // history, folded here because MASTERY_EVENTS stores labels, not keys — a
    // label variant that folds into the subtree still counts. One player's
    // history is small at this scale.
    const pairRows = await db
      .selectDistinct({
        label: masteryEvents.canonicalSubcategory,
        questionId: masteryEvents.questionId,
      })
      .from(masteryEvents)
      .where(eq(masteryEvents.answeredByUserId, userId));

    for (const [domain, descendants] of descendantsByDomain) {
      const clusterKeys = new Set([domainKey(domain), ...descendants]);
      const answered = new Set<string>();
      for (const row of pairRows) {
        if (!row.questionId) continue;
        if (clusterKeys.has(domainKey(row.label))) answered.add(row.questionId);
      }
      // Never below the base exact-label count: the roll-up only adds.
      if (answered.size > (result.get(domain) ?? 0)) result.set(domain, answered.size);
    }
  } catch (error) {
    console.warn('[set-completion] graph roll-up skipped (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return result;
}

/**
 * For the domains a player was active in this round, designate + invite the ones
 * they've just completed. Returns the newly-completed domains (for logging).
 * Side-effecting but idempotent; safe to call every summary.
 */
export async function evaluateSetCompletions(
  userId: string,
  domains: string[],
): Promise<string[]> {
  const unique = [...new Set(domains.filter(Boolean))];
  if (unique.length === 0) return [];

  const completed: string[] = [];
  try {
    const answeredByDomain = await distinctAnsweredByDomain(userId, unique);
    // Only a domain the player has answered enough DISTINCT questions in can be a
    // completed set — gate the (LLM) depth sizing to those, so we never sprinkle
    // depth calls across every touched-but-nowhere-near-complete domain. The floor
    // is the smallest target any topic can have.
    const gateFloor = isDepthSizedCompletionEnabled()
      ? minPossibleTargetCount()
      : SET_COMPLETION_MIN_SIZE;
    const candidates = unique.filter((domain) => (answeredByDomain.get(domain) ?? 0) >= gateFloor);
    if (candidates.length === 0) return [];

    const setSizeByDomain = await getSetSizesForDomains(candidates);
    const now = new Date();
    for (const domain of candidates) {
      const setSize = setSizeByDomain.get(domain) ?? 0;
      const distinctAnswered = answeredByDomain.get(domain) ?? 0;
      if (!isSetComplete({ distinctAnswered, setSize })) continue;
      // Cheap guard first so a repeat call skips the writes entirely; the writes
      // are themselves idempotent, so a race is harmless.
      if (await hasDesignation(userId, domain)) continue;
      await markDomainDesignated(userId, domain, now);
      await inviteToAuthorAutomatic({ userId, domain });
      // Phase 1b: completing the set makes the domain eligible for the graduation
      // ("branch out to a neighbor topic") offer built later in this same summary.
      // Best-effort — a graduation-eligibility miss must not drop the trophy.
      await markDomainExpansionEligible(userId, domain).catch((error) => {
        console.warn('[set-completion] markDomainExpansionEligible failed (non-fatal)', {
          userId,
          domain,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      completed.push(domain);
    }
  } catch (error) {
    console.warn('[set-completion] evaluation failed (non-fatal)', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return completed;
}
