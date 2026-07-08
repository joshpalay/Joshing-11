/**
 * D-DIFFICULTY-SIZE-COMPLETION-01 — depth-sized completion targets.
 *
 * A topic is a finite completable SET whose size is its real DEPTH, not whatever
 * questions happen to exist. Each topic's target distinct-question count is
 * derived from an LLM depth score (1-10) via `count = coefficient x depth^2`,
 * clamped. Deep topics get large targets (a long runway that rarely completes —
 * "keep going"); thin topics get small targets (reached fast → trophy →
 * graduate). See set-completion.ts for the consumer.
 *
 * The DEPTH score is what's cached (DomainDepthEstimate, one Haiku call per topic
 * ever); the COUNT is derived here at read time from env knobs, so re-tuning the
 * curve later is a config change with NO re-seed and NO migration.
 */
import { domainKey } from '@/lib/knowledge/domain-key';
import { scoreDomainDepth } from '@/server/llm/domain-depth';
import { getClusterContext, substantiveDescendants } from '@/server/knowledge/graph';
import {
  getDepthEstimates,
  upsertDepthEstimate,
  type DepthEstimateRow,
} from '@/server/db/queries/domain-depth-estimate';

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Env-tunable depth→count curve. Defaults chosen with Josh (2026-07-06):
// count ≈ 2·depth² → Spy School (depth ~3) ≈ 18, Star Wars (depth ~8) ≈ 128.
// Bump DOMAIN_SIZE_COUNT_COEFFICIENT to make every set larger without a re-seed.
export const depthCountCoefficient = (): number => numEnv('DOMAIN_SIZE_COUNT_COEFFICIENT', 2);
export const depthTargetMin = (): number => Math.round(numEnv('DOMAIN_SIZE_TARGET_MIN', 12));
export const depthTargetMax = (): number => Math.round(numEnv('DOMAIN_SIZE_TARGET_MAX', 200));
// Fallback depth when the LLM can't score a topic (negative cache) — a modest
// middle value so an unsizable topic still completes at a sane count.
export const defaultDepth = (): number => Math.round(numEnv('DOMAIN_SIZE_DEFAULT_DEPTH', 4));

/**
 * Pure: depth (1-10) → target distinct-question count for completion.
 * count = coefficient · depth², clamped to [min, max]. Exported for unit tests.
 */
export function depthToTargetCount(
  depth: number,
  opts?: { coefficient?: number; min?: number; max?: number },
): number {
  const coefficient = opts?.coefficient ?? depthCountCoefficient();
  const min = opts?.min ?? depthTargetMin();
  const max = opts?.max ?? depthTargetMax();
  const d = Math.max(1, Math.min(10, Math.round(depth)));
  const raw = Math.round(coefficient * d * d);
  return Math.max(min, Math.min(max, raw));
}

/** The smallest target any topic can have — the "is this even a set" floor. */
export function minPossibleTargetCount(): number {
  return depthTargetMin();
}

/**
 * For each canonical_subcategory, the depth-sized target distinct-question count
 * for set completion. Folds each topic to its domain_key, reads the cached depth
 * (computing + caching on miss via one Haiku call), and derives the count. Fully
 * fail-open: any read/scoring error falls back to the default depth so a sizing
 * miss never blocks completion evaluation.
 */
export async function getTargetQuestionCountForDomains(
  canonicalSubcategories: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const unique = [...new Set(canonicalSubcategories.filter(Boolean))];
  if (unique.length === 0) return out;

  const keyByCanonical = new Map(unique.map((canonical) => [canonical, domainKey(canonical)]));
  const keys = [...new Set(keyByCanonical.values())];

  const cached = await getDepthEstimates(keys).catch(() => new Map());

  // Target-count precedence: admin manual override (0119) > corpus-grounded
  // estimate (D-SUPPLY-FINITENESS-01) > coefficient·depth² fallback. A resolved
  // Wikipedia/Wikidata/Fandom count is a truer set size than depth², and a
  // human's number is truer still.
  const estimateByKey = new Map<string, number>();
  const depthByKey = new Map<string, number>();
  for (const key of keys) {
    const row = cached.get(key);
    if (row) {
      const preferred = row.manualEstimatedQuestions ?? row.estimatedQuestions;
      if (preferred != null) estimateByKey.set(key, preferred);
      depthByKey.set(key, row.depthScore ?? defaultDepth());
      continue;
    }
    // Cache miss — score once (Haiku) and cache. A representative label is any
    // canonical string that folds to this key.
    const sampleLabel = unique.find((canonical) => keyByCanonical.get(canonical) === key) ?? key;
    let depth: number | null = null;
    try {
      depth = await scoreDomainDepth(sampleLabel);
    } catch {
      depth = null;
    }
    depthByKey.set(key, depth ?? defaultDepth());
    // Best-effort cache write (negative-cache on null); never block on it.
    void upsertDepthEstimate({
      domainKey: key,
      depthScore: depth,
      sampleLabel,
      source: depth == null ? 'default' : 'llm',
    }).catch(() => {});
  }

  // Parent subtree-union sizing (D-MASTERY-FINEST-NODE-01 §3): a parent's
  // finite set is the UNION of its substantive descendants' sets — "complete
  // Shakespeare Tragedies" means breadth across the plays, not one genre
  // article's section count. For requested domains that are authored nodes
  // with substantive descendants, the target becomes max(own, Σ descendants)
  // — max, not sum-of-both, because under total containment the parent's own
  // pool overlaps the children's sets. Cached rows only (no LLM calls for
  // unplayed descendants); a manual admin override on the parent wins over
  // the union; graph faults fall back to per-node sizing. The per-domain
  // finiteness state machine / discrepancy alarm reads raw rows, not this,
  // and is deliberately untouched.
  try {
    const ctx = await getClusterContext();
    if (ctx.nodeKeys.size > 0 && ctx.edges.length > 0) {
      const descendantsByKey = new Map<string, Set<string>>();
      for (const key of keys) {
        if (!ctx.nodeKeys.has(key)) continue;
        const descendants = substantiveDescendants(key, ctx.edges);
        if (descendants.size > 0) descendantsByKey.set(key, descendants);
      }
      if (descendantsByKey.size > 0) {
        const descendantKeys = new Set<string>();
        for (const descendants of descendantsByKey.values()) {
          for (const key of descendants) descendantKeys.add(key);
        }
        const missing = [...descendantKeys].filter((key) => !cached.has(key));
        const fetched: Map<string, DepthEstimateRow> =
          missing.length > 0 ? await getDepthEstimates(missing) : new Map();
        const sizeForRow = (row: DepthEstimateRow): number | null =>
          row.manualEstimatedQuestions ??
          row.estimatedQuestions ??
          (row.depthScore != null ? depthToTargetCount(row.depthScore) : null);

        for (const [key, descendants] of descendantsByKey) {
          if (cached.get(key)?.manualEstimatedQuestions != null) continue;
          let unionSize = 0;
          for (const childKey of descendants) {
            const row = cached.get(childKey) ?? fetched.get(childKey);
            const size = row ? sizeForRow(row) : null;
            if (size != null) unionSize += size;
          }
          if (unionSize <= 0) continue;
          const own =
            estimateByKey.get(key) ?? depthToTargetCount(depthByKey.get(key) ?? defaultDepth());
          if (unionSize > own) estimateByKey.set(key, unionSize);
        }
      }
    }
  } catch (error) {
    console.warn('[domain-size] subtree-union sizing skipped (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  for (const canonical of unique) {
    const key = keyByCanonical.get(canonical)!;
    const corpus = estimateByKey.get(key);
    out.set(
      canonical,
      corpus != null ? corpus : depthToTargetCount(depthByKey.get(key) ?? defaultDepth()),
    );
  }
  return out;
}
