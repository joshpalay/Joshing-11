/**
 * Mastery v2 (docs/thinking/MASTERY-MODEL-v2.md) — Phase 2: node DEPTH-WEIGHT
 * seeding.
 *
 * A node's weight is a topic-size / breadth proxy on a 1–10 scale, seeded once at
 * node creation (and backfillable) and human-overridable. It is stored in
 * KnowledgeNode.node_weight (migration 0109) and read by NOTHING yet — the v2 read
 * path is Phase 5. Distinct from mastery_threshold (the v1 parent bar) and from
 * "N Qs" depth (a question count).
 *
 * Source order (spec refinement #3): Wikidata P279 child-count first (already
 * wired, cached, no new HTTP), LLM depth score as fallback for the hyper-specific
 * territories Wikidata can't resolve. Both normalize to the same 1–10 scale.
 *
 * The pure normalization (`weightFromChildCount`) and the dependency-injected
 * orchestrator are unit-tested without network or LLM.
 */

import { getWikidataStructure } from '@/server/knowledge/wikidata';
import { scoreDomainDepth } from '@/server/llm/domain-depth';

export const MIN_NODE_WEIGHT = 1;
export const MAX_NODE_WEIGHT = 10;

export type NodeWeightSource = 'wikidata' | 'llm' | 'none';
export type NodeWeightResult = { weight: number | null; source: NodeWeightSource };

function clampWeight(n: number): number {
  return Math.max(MIN_NODE_WEIGHT, Math.min(MAX_NODE_WEIGHT, Math.round(n)));
}

/**
 * Map a Wikidata P279 (subclass-of) direct child count to a 1–10 breadth score.
 * Log-shaped so breadth grows fast at the low end and saturates: 0→1, 3→3, 7→4,
 * ~50→7, ~500→10. CALIBRATION-PENDING — the shape is a tunable knob (like
 * mastery-v2's DEFAULT_POINTS_PER_WEIGHT); it feeds nothing until Phase 5.
 */
export function weightFromChildCount(children: number): number {
  const n = Number.isFinite(children) && children > 0 ? children : 0;
  return clampWeight(1 + Math.log2(1 + n));
}

export type ComputeNodeWeightDeps = {
  /** Direct Wikidata subclass child count for a label, or null if unresolved. */
  wikidataChildCount?: (label: string) => Promise<number | null>;
  /** LLM depth score 1–10, or null if unavailable. */
  llmDepthScore?: (label: string) => Promise<number | null>;
};

const defaultWikidataChildCount = async (label: string): Promise<number | null> => {
  const structure = await getWikidataStructure(label);
  return structure ? structure.children.length : null;
};

/**
 * Seed a node's depth weight for a label. Wikidata child-count first; LLM depth
 * score fallback; null (unseeded) when neither resolves. Each source fails open —
 * a fault in one falls through to the next, never throws. Deps are injectable for
 * pure tests.
 */
export async function computeNodeWeight(
  label: string,
  deps: ComputeNodeWeightDeps = {},
): Promise<NodeWeightResult> {
  const clean = label.trim();
  if (!clean) return { weight: null, source: 'none' };

  const wikidataChildCount = deps.wikidataChildCount ?? defaultWikidataChildCount;
  const llmDepthScore = deps.llmDepthScore ?? scoreDomainDepth;

  try {
    const children = await wikidataChildCount(clean);
    if (children !== null && Number.isFinite(children)) {
      return { weight: weightFromChildCount(children), source: 'wikidata' };
    }
  } catch {
    // fall through to the LLM
  }

  try {
    const score = await llmDepthScore(clean);
    if (score !== null && Number.isFinite(score)) {
      return { weight: clampWeight(score), source: 'llm' };
    }
  } catch {
    // fall through to unseeded
  }

  return { weight: null, source: 'none' };
}
