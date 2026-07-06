// D-DIFFICULTY-SIZE-COMPLETION-01 — read/write for the cached topic depth score
// (DomainDepthEstimate, migration 0116). Keyed on the folded domain_key so it
// covers every played canonical_subcategory, not just authored KnowledgeNodes.
import { inArray } from 'drizzle-orm';

import { db, domainDepthEstimates } from '@/server/db';

export type DepthEstimateRow = {
  domainKey: string;
  depthScore: number | null;
  source: string;
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
