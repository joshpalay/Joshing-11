/**
 * Domain convergence — deterministic dedup of a freshly-suggested knowledge
 * category against the ones that already exist across the game.
 *
 * The goal (locked product decision) is CONVERGENCE ONLY: when a user types — or
 * a friend pre-seeds — a category, align it onto an existing canonical
 * subcategory if a close match exists, so the same hyper-specific domain doesn't
 * fragment into per-user spelling variants ("90s Hip Hop" / "90's hip-hop" /
 * "1990s Hip Hop") whose mastery points never merge.
 *
 * Deterministic, LLM-free. Two passes over the corpus (every player's
 * PLAYER_MASTERY.canonical_subcategory):
 *   1. exact-key  — domainKey() equality. Works without pg_trgm.
 *   2. fuzzy      — pg_trgm similarity() >= threshold. Needs pg_trgm; degrades
 *                   to nothing when the extension is absent (caught, non-fatal).
 * A "create new" candidate (the user's own cleaned wording) is ALWAYS appended
 * unless an exact match already covers it, so convergence is never forced — the
 * escape hatch for false positives.
 *
 * Only exact matches are safe to auto-prefer; fuzzy matches must be surfaced as
 * a dismissible "Did you mean X?" with "create new" as the alternative, because
 * trigram similarity is purely lexical ("Roman Empire" ~ "Holy Roman Empire").
 */

import { domainKey } from '@/lib/knowledge/domain-key';
import {
  findExactCanonicalMatch,
  findFuzzyCanonicalMatches,
  type CanonicalCorpusMatch,
} from '@/server/db/queries/knowledge';

// pg_trgm similarity threshold (0..1). NOT cosine — trigram scores run lower
// (pg_trgm's own default similarity_threshold is 0.3). Start conservative for
// high precision (few wrong-domain false positives) and tune against the real
// corpus; override per-environment without a deploy. Mirrors
// DEFAULT_DEDUP_COSINE_THRESHOLD in src/server/pool/dedup.ts.
export const DEFAULT_CONVERGE_TRGM_THRESHOLD = 0.55;

// Privacy floor: only surface a FUZZY candidate shared by at least this many
// players. Matching one user's input against every user's declared labels could
// otherwise reveal that *someone* declared an idiosyncratic phrase. Exact
// matches (the user typed essentially the same thing) are exempt. Prevalence
// counts are used for ranking/this floor only and are NEVER shown in the UI.
export const DEFAULT_CONVERGE_FUZZY_MIN_PREVALENCE = 3;

// How many fuzzy suggestions to show at most.
export const DEFAULT_CONVERGE_FUZZY_LIMIT = 3;

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

export function getConvergeTrgmThreshold(): number {
  const raw = process.env.KNOWLEDGE_CONVERGE_TRGM_THRESHOLD?.trim();
  if (!raw) return DEFAULT_CONVERGE_TRGM_THRESHOLD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    return DEFAULT_CONVERGE_TRGM_THRESHOLD;
  }
  return parsed;
}

export function getConvergeFuzzyMinPrevalence(): number {
  return readPositiveIntEnv(
    'KNOWLEDGE_CONVERGE_FUZZY_MIN_PREVALENCE',
    DEFAULT_CONVERGE_FUZZY_MIN_PREVALENCE,
  );
}

export type ConvergeCandidateKind = 'exact' | 'fuzzy' | 'new';

export type ConvergeCandidate = {
  /** The label to actually persist when this candidate is chosen. */
  label: string;
  broadCategory: string | null;
  kind: ConvergeCandidateKind;
  /** 1 for exact, the trigram score for fuzzy, 0 for "create new". */
  similarity: number;
};

export type ConvergeResult = {
  /** The input after the same trim/whitespace cleanup the write path applies. */
  raw: string;
  /** Ranked: exact → fuzzy (desc) → "create new" fallback. */
  candidates: ConvergeCandidate[];
};

export type ConvergeOptions = {
  threshold?: number;
  minPrevalence?: number;
  limit?: number;
};

export async function convergeDomain(
  rawLabel: string,
  opts: ConvergeOptions = {},
): Promise<ConvergeResult> {
  const cleaned = rawLabel.trim().replace(/\s+/g, ' ');
  const result: ConvergeResult = { raw: cleaned, candidates: [] };
  if (!cleaned) return result;

  const threshold = opts.threshold ?? getConvergeTrgmThreshold();
  const minPrevalence = opts.minPrevalence ?? getConvergeFuzzyMinPrevalence();
  const limit = opts.limit ?? DEFAULT_CONVERGE_FUZZY_LIMIT;

  const inputKey = domainKey(cleaned);
  const seen = new Set<string>();

  // 1. Exact-key convergence (pg_trgm not required).
  let exact: CanonicalCorpusMatch | null = null;
  try {
    exact = await findExactCanonicalMatch(cleaned);
  } catch (error) {
    console.warn('[converge-domain] exact match query failed (non-fatal)', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (exact) {
    result.candidates.push({
      label: exact.label,
      broadCategory: exact.broadCategory,
      kind: 'exact',
      similarity: 1,
    });
    seen.add(domainKey(exact.label));
  }

  // 2. Fuzzy convergence (pg_trgm). Privacy K-floor; never auto-applies.
  try {
    const fuzzy = await findFuzzyCanonicalMatches(cleaned, threshold, limit + 2);
    let added = 0;
    for (const match of fuzzy) {
      if (added >= limit) break;
      const matchKey = domainKey(match.label);
      if (seen.has(matchKey)) continue;
      if (match.prevalence < minPrevalence) continue;
      result.candidates.push({
        label: match.label,
        broadCategory: match.broadCategory,
        kind: 'fuzzy',
        similarity: match.similarity,
      });
      seen.add(matchKey);
      added += 1;
    }
  } catch (error) {
    // pg_trgm likely unavailable (function similarity() does not exist) — the
    // exact + "create new" candidates still stand. Best-effort, like the pool
    // dedup backstop (src/server/pool/dedup.ts).
    console.warn('[converge-domain] fuzzy match skipped (pg_trgm unavailable?)', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  // 3. Always-present "create new" fallback (escape hatch). Skipped only when an
  // exact match already covers the input key — converging onto it is identical.
  if (!seen.has(inputKey)) {
    result.candidates.push({
      label: cleaned,
      broadCategory: null,
      kind: 'new',
      similarity: 0,
    });
  }

  return result;
}
