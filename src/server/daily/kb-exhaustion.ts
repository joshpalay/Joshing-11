// Narrow-KB exhaustion guard.
//
// THE PROBLEM. A "narrow" declared interest — a single book series, one video
// game, a niche fandom — holds only a finite set of quizable facts. The
// ungrounded per-user generator (Sonnet writing from memory) exhausts those real
// facts FAST: an audit of "Spy School Books 1-6" found the model fabricating
// plausible-but-false canon (an invented "Academy of Evil" cover name, a real
// university named as a fictional school's front) at a durable pool depth of
// only ~7 facts. The downstream factual gate cannot catch this — an A/B over the
// exact questions showed neither Sonnet nor Opus, under any prompt, reliably
// flags fabricated niche-fiction canon, because the gate shares the generator's
// blind spot. A fabricated novel question looks exactly like a real novel one.
//
// THE GUARD. There is no per-question signal that distinguishes fabrication from
// fact for a niche KB (that is the whole reason the gate fails). The only robust,
// INDEPENDENT signal is provenance + pool depth: a declared-interest domain whose
// durable machine pool is still THIN is exactly the domain that (a) keeps
// falling through to fresh ungrounded generation and (b) retrieval-grounded
// refill is meant to own. So when the guard is enabled we STOP fabricating
// ungrounded novelty for thin declared-interest domains and hand them to the
// grounded path; the live slot is served from already-pooled grounded/authored
// /bank rows, and backfilled from the user's other (non-thin) domains.
//
// CO-DEPENDENCE WITH GROUNDING. The thinness boundary is deliberately SHARED with
// retrieval grounding's poolDepthThreshold (getRetrievalConfig().poolDepthThreshold)
// so "stop fabricating" and "start grounding" fire on the same line — no drift.
// Enabling this guard WITHOUT enabling retrieval grounding (RETRIEVAL_GROUNDING_ENABLED)
// will simply suppress fresh questions for thin narrow domains until their pool
// is deepened by some other route; the two flags are meant to be flipped together.
//
// SAFE BY DEFAULT. NARROW_KB_GUARD_ENABLED defaults OFF — landing this module is
// a no-op in production until an operator deliberately turns it on alongside the
// grounding flip (docs/retrieval-flip-checklist.md). The wiring in
// generateDailyQuestionsFromKnowledgeBase is fail-open: any error proceeds
// ungated, exactly as today.

import { getRetrievalConfig } from '@/server/daily/retrieval-config';

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

/** Master switch. Off by default — see the module header. */
export function isNarrowKbGuardEnabled(): boolean {
  return boolEnv('NARROW_KB_GUARD_ENABLED', false);
}

/**
 * Whether a thin declared area touched in a completed round may trigger an
 * expansion offer (B-AREA-EXPANSION-01, Phase 2). Off by default and INDEPENDENT
 * of NARROW_KB_GUARD_ENABLED: the guard suppresses fabrication, whereas this only
 * decides whether the player is *offered* broader/wider areas — a safe, additive,
 * player-visible nudge. Kept dark until the expansion write path (Phases 3+) is
 * reviewed, and so it can be flipped alongside the retrieval grounding work
 * (docs/retrieval-flip-checklist.md) rather than silently changing prod.
 */
export function isAreaExpansionThinnessTriggerEnabled(): boolean {
  return boolEnv('AREA_EXPANSION_THINNESS_TRIGGER_ENABLED', false);
}

/**
 * Whether an exhausted ("thin") child area whose slot the guard suppressed should
 * hand that slot UP to its recorded expansion parent (B-AREA-EXPANSION-01, Phase
 * 5 / R4) — e.g. a tapped-out "Pride" draws from "Moral Philosophy" instead of
 * the orchestrator backfilling from unrelated domains. Off by default and only
 * meaningful when the narrow-KB guard is on (it refines what the guard does with
 * a suppressed domain). Kept dark so it can be flipped alongside the guard /
 * retrieval grounding rather than silently changing generation.
 */
export function isAreaExpansionParentOverflowEnabled(): boolean {
  return boolEnv('AREA_EXPANSION_PARENT_OVERFLOW_ENABLED', false);
}

/**
 * The pool depth (distinct durable facts) below which a domain counts as "thin".
 * Shared verbatim with grounding's poolDepthThreshold so the guard hands a domain
 * to grounded refill at exactly the boundary grounding considers it thin.
 */
export function narrowKbThinnessThreshold(): number {
  return getRetrievalConfig().poolDepthThreshold;
}

export type DomainGuardInput = {
  domain: string;
  /** True when the user explicitly declared this interest (territoryType === 'declared'). */
  isDeclaredInterest: boolean;
  /** Distinct durable facts already in the machine pool for this domain. */
  poolDepth: number;
};

/**
 * Pure. Given the candidate domains for fresh UNGROUNDED generation, return the
 * subset to EXCLUDE: declared-interest domains whose durable pool is still thin
 * (depth strictly below the threshold). Demonstrated domains are never excluded
 * (a thin demonstrated domain is usually just new, not a narrow fan KB), and a
 * declared domain that has been grounded/mined past the threshold rejoins normal
 * generation.
 */
export function selectUngroundedExcludedDomains(
  inputs: readonly DomainGuardInput[],
  threshold: number,
): Set<string> {
  const excluded = new Set<string>();
  for (const input of inputs) {
    if (input.isDeclaredInterest && input.poolDepth < threshold) {
      excluded.add(input.domain);
    }
  }
  return excluded;
}

/**
 * Pure. Given the expansion parents of suppressed thin children, return the
 * distinct parents to route their freed slots to (B-AREA-EXPANSION-01, Phase 5).
 * A parent qualifies only if the user actually holds it as a territory (so the
 * generator has territory/strength context for it) and it isn't already being
 * served this round (bank-filled or already in the palette). First-seen order,
 * de-duped.
 */
export function selectOverflowParents(
  parents: Iterable<string>,
  isHeldTerritory: (domain: string) => boolean,
  isAlreadyServed: (domain: string) => boolean,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const parent of parents) {
    if (seen.has(parent) || !isHeldTerritory(parent) || isAlreadyServed(parent)) continue;
    seen.add(parent);
    out.push(parent);
  }
  return out;
}

export type ThinAreaCandidate = { domain: string; poolDepth: number };

/**
 * Pure. Pick the single thinnest declared area eligible for an expansion offer
 * (B-AREA-EXPANSION-01, A3: one graduation per game, the thinnest area touched).
 * A candidate qualifies when its pool is thin (depth strictly below the threshold,
 * the SAME boundary as selectUngroundedExcludedDomains so the two never drift) and
 * it has not already been offered. Ties break by lowest depth, then domain name
 * for determinism. Returns null when nothing qualifies.
 */
export function selectThinnestEligibleArea(
  candidates: readonly ThinAreaCandidate[],
  threshold: number,
  alreadyOffered: ReadonlySet<string>,
): string | null {
  const eligible = candidates
    .filter((c) => c.poolDepth < threshold && !alreadyOffered.has(c.domain))
    .sort((a, b) => a.poolDepth - b.poolDepth || a.domain.localeCompare(b.domain));
  return eligible[0]?.domain ?? null;
}
