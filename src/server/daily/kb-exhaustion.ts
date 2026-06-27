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
