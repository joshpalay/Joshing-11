/**
 * D-SUPPLY-FINITE-SET-01 P2 — set-completion detection.
 *
 * A domain is a finite completable SET (~the fan-salient questions it holds).
 * When a player has answered the whole set, they earn a durable DESIGNATION
 * (recognition only — no mechanical effect) and an AUTOMATIC invitation to
 * author more, which lights the already-built /invited trophy takeover.
 *
 * Completion is COVERAGE-based (Josh, 2026-07-05): the player has answered at
 * least as many DISTINCT questions as the set holds distinct facts. We compare
 * distinct-answered (not the raw answer-event count — repeats/catch-up must not
 * trophy a replay) against the durable pool depth (the set size at current
 * scale), gated by a floor so a 3-question domain isn't called a "set".
 *
 * Fail-open and idempotent: a designation stamps once (guarded on
 * designated_at IS NULL) and the invitation's partial unique index makes a
 * re-fire a no-op, so an over-eager or repeated call is harmless; an error
 * never breaks the summary it runs inside.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, masteryEvents } from '@/server/db';
import {
  hasDesignation,
  inviteToAuthorAutomatic,
  markDomainDesignated,
} from '@/server/db/queries/author-invitations';
import { getDurablePoolDepthForDomains } from '@/server/db/queries/retrieval-demand';

// Below this many distinct facts a domain isn't a "set" worth a trophy — a
// thin domain a player exhausts is surfaced to the human via the crafter
// worklist instead (the P1 expensive/thin signal), not celebrated. Tunable.
export const SET_COMPLETION_MIN_SIZE = 8;

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
  return new Map(rows.filter((r) => r.domain).map((r) => [r.domain as string, Number(r.answered)]));
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
    const [answeredByDomain, poolDepthByDomain] = await Promise.all([
      distinctAnsweredByDomain(userId, unique),
      getDurablePoolDepthForDomains(unique),
    ]);
    const now = new Date();
    for (const domain of unique) {
      const setSize = poolDepthByDomain.get(domain) ?? 0;
      const distinctAnswered = answeredByDomain.get(domain) ?? 0;
      if (!isSetComplete({ distinctAnswered, setSize })) continue;
      // Cheap guard first so a repeat call skips the writes entirely; the writes
      // are themselves idempotent, so a race is harmless.
      if (await hasDesignation(userId, domain)) continue;
      await markDomainDesignated(userId, domain, now);
      await inviteToAuthorAutomatic({ userId, domain });
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
