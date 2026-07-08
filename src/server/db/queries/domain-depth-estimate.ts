// D-DIFFICULTY-SIZE-COMPLETION-01 — read/write for the cached topic depth score
// (DomainDepthEstimate, migration 0116). Keyed on the folded domain_key so it
// covers every played canonical_subcategory, not just authored KnowledgeNodes.
import { inArray } from 'drizzle-orm';

import { db, domainDepthEstimates } from '@/server/db';

export type DepthEstimateRow = {
  domainKey: string;
  depthScore: number | null;
  source: string;
  // Corpus-grounded size (0117). When present, the PREFERRED target count.
  estimatedQuestions: number | null;
};

/** Cached depth estimates for the given folded domain keys. */
export async function getDepthEstimates(
  domainKeys: string[],
): Promise<Map<string, DepthEstimateRow>> {
  if (domainKeys.length === 0) return new Map();
  const rows = await db
    .select({
      domainKey: domainDepthEstimates.domainKey,
      depthScore: domainDepthEstimates.depthScore,
      source: domainDepthEstimates.source,
      estimatedQuestions: domainDepthEstimates.estimatedQuestions,
    })
    .from(domainDepthEstimates)
    .where(inArray(domainDepthEstimates.domainKey, domainKeys));
  return new Map(rows.map((row) => [row.domainKey, row]));
}

/**
 * Cache a depth estimate. depthScore null is a negative cache (sizing ran, the
 * LLM returned nothing) — readers fall back to the default depth without
 * re-billing until a deliberate re-score. First-writer-agnostic: an upsert so a
 * concurrent org-wide sizing of the same topic converges.
 */
export async function upsertDepthEstimate(input: {
  domainKey: string;
  depthScore: number | null;
  sampleLabel: string;
  source: 'llm' | 'default';
}): Promise<void> {
  await db
    .insert(domainDepthEstimates)
    .values({
      domainKey: input.domainKey,
      depthScore: input.depthScore,
      sampleLabel: input.sampleLabel,
      source: input.source,
    })
    .onConflictDoUpdate({
      target: domainDepthEstimates.domainKey,
      set: {
        depthScore: input.depthScore,
        sampleLabel: input.sampleLabel,
        source: input.source,
        computedAt: new Date(),
      },
    });
}

/**
 * Cache a CORPUS-grounded size estimate (0117, D-SUPPLY-FINITENESS-01). Writes
 * estimated_questions (the number getTargetQuestionCountForDomains prefers) plus
 * the resolution provenance for the coverage dashboard + confidence-gated alarm.
 * Leaves depth_score untouched (keyed on the same domain_key, so it coexists with
 * any depth row). Upsert so a re-run / concurrent org-wide sizing converges.
 */
export async function upsertCorpusSizeEstimate(input: {
  domainKey: string;
  sampleLabel: string;
  estimatedQuestions: number | null;
  corpusCount: number | null;
  shape: string;
  confidence: string;
  basis: string;
  wikipediaTitle: string | null;
  wikidataQid: string | null;
  fandomHost: string | null;
}): Promise<void> {
  const set = {
    sampleLabel: input.sampleLabel,
    source: 'corpus' as const,
    estimatedQuestions: input.estimatedQuestions,
    corpusCount: input.corpusCount,
    shape: input.shape,
    confidence: input.confidence,
    basis: input.basis,
    wikipediaTitle: input.wikipediaTitle,
    wikidataQid: input.wikidataQid,
    fandomHost: input.fandomHost,
    resolvedAt: new Date(),
    computedAt: new Date(),
  };
  await db
    .insert(domainDepthEstimates)
    .values({ domainKey: input.domainKey, ...set })
    .onConflictDoUpdate({ target: domainDepthEstimates.domainKey, set });
}
