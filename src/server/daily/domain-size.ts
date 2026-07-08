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
import {
  getDepthEstimates,
  upsertDepthEstimate,
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

  // Corpus-grounded target counts win outright when present (D-SUPPLY-FINITENESS-01):
  // a resolved Wikipedia/Wikidata/Fandom count is a truer set size than
  // coefficient·depth². Depth remains the fallback for keys with no corpus row.
  const estimateByKey = new Map<string, number>();
  const depthByKey = new Map<string, number>();
  for (const key of keys) {
    const row = cached.get(key);
    if (row) {
      if (row.estimatedQuestions != null) estimateByKey.set(key, row.estimatedQuestions);
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
