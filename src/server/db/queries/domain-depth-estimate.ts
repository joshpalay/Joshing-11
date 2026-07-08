// D-DIFFICULTY-SIZE-COMPLETION-01 — read/write for the cached topic depth score
// (DomainDepthEstimate, migration 0116). Keyed on the folded domain_key so it
// covers every played canonical_subcategory, not just authored KnowledgeNodes.
import { eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { db, domainDepthEstimates, generatedQuestions } from '@/server/db';

export type DepthEstimateRow = {
  domainKey: string;
  depthScore: number | null;
  source: string;
  sampleLabel: string | null;
  // Corpus-grounded size (0117). When present, the PREFERRED target count.
  estimatedQuestions: number | null;
  // Admin override (0119). When present, wins over estimatedQuestions.
  manualEstimatedQuestions: number | null;
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
      sampleLabel: domainDepthEstimates.sampleLabel,
      estimatedQuestions: domainDepthEstimates.estimatedQuestions,
      manualEstimatedQuestions: domainDepthEstimates.manualEstimatedQuestions,
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

/**
 * Dry-round observation write (0118, D-SUPPLY-FINITENESS-01 #4). After a fresh
 * generation round, reset the counter (+ stamp last_yield_at) for domains that
 * yielded a surviving row, and increment it for domains that were OFFERED to
 * the model but yielded nothing. UPDATE-only: a domain with no estimate row yet
 * simply isn't observed (it gets a row lazily via the sizing paths). Fire-and-
 * forget telemetry — callers void+catch; a miss never touches generation.
 */
export async function recordSupplyYieldObservation(input: {
  yieldedDomainKeys: string[];
  dryDomainKeys: string[];
}): Promise<void> {
  const yielded = [...new Set(input.yieldedDomainKeys)].filter(Boolean);
  const dry = [...new Set(input.dryDomainKeys)].filter(Boolean)
    .filter((key) => !yielded.includes(key));
  if (yielded.length > 0) {
    await db
      .update(domainDepthEstimates)
      .set({ consecutiveDryRounds: 0, lastYieldAt: new Date() })
      .where(inArray(domainDepthEstimates.domainKey, yielded));
  }
  if (dry.length > 0) {
    await db
      .update(domainDepthEstimates)
      .set({ consecutiveDryRounds: sql`${domainDepthEstimates.consecutiveDryRounds} + 1` })
      .where(inArray(domainDepthEstimates.domainKey, dry));
  }
}

/**
 * Co-calibration write (0119) — the "raise_estimate corrects UPWARD" arrow of
 * the supply-state machine (supply-state.ts), previously a comment with no
 * code. For the given domain keys (callers pass the keys that just YIELDED — a
 * domain can only newly cross the boundary on a round it yields in), any row
 * whose realized distinct-fact count has met or passed its corpus estimate is
 * raised to ceil(realized / nearRatio), so the domain re-enters `filling` with
 * headroom instead of sitting in `raise_estimate` forever. Guardrails:
 *  - only raises, never lowers (realized >= estimate is the trigger);
 *  - skips rows with a manual admin override (manual_estimated_questions);
 *  - skips unsized rows (no corpus estimate to calibrate);
 *  - realized = count(distinct fact_key), the SAME definition the coverage
 *    read uses, so the dashboard and the calibration always agree.
 * Fire-and-forget telemetry-grade: callers void+catch.
 */
export async function coCalibrateRaisedEstimates(
  domainKeys: string[],
  nearRatio: number,
): Promise<void> {
  const keys = [...new Set(domainKeys)].filter(Boolean);
  if (keys.length === 0 || !(nearRatio > 0)) return;
  await db.execute(sql`
    UPDATE "DomainDepthEstimate" d
    SET "estimated_questions" = CEIL(r.realized / ${nearRatio}::float8)::int,
        "calibrated_at" = now()
    FROM (
      SELECT "domain_key", count(distinct "fact_key")::int AS realized
      FROM "GeneratedQuestion"
      WHERE "fact_key" IS NOT NULL AND "domain_key" = ANY(${keys})
      GROUP BY "domain_key"
    ) r
    WHERE d."domain_key" = r."domain_key"
      AND d."estimated_questions" IS NOT NULL
      AND d."manual_estimated_questions" IS NULL
      AND r.realized >= d."estimated_questions"
  `);
}

/**
 * Admin manual estimate override (0119). value=null clears the override so the
 * domain returns to its corpus/depth path. UPDATE-only: the /admin/supply rows
 * all exist in the table by construction; returns false when the key has no
 * row so the API can 404 instead of silently no-oping.
 */
export async function setManualEstimate(
  domainKeyValue: string,
  value: number | null,
): Promise<boolean> {
  const rows = await db
    .update(domainDepthEstimates)
    .set({ manualEstimatedQuestions: value })
    .where(eq(domainDepthEstimates.domainKey, domainKeyValue))
    .returning({ domainKey: domainDepthEstimates.domainKey });
  return rows.length > 0;
}

/**
 * Admin generation cap (0121). value=true stamps generation_capped_at (now);
 * value=false clears it. A capped domain is excluded from fresh generation
 * everywhere generateDailyQuestionsFromKnowledgeBase builds its palette; serving
 * is untouched. UPDATE-only like setManualEstimate: the /admin/supply rows all
 * exist by construction; returns false when the key has no row so the API 404s.
 */
export async function setGenerationCap(
  domainKeyValue: string,
  capped: boolean,
): Promise<boolean> {
  const rows = await db
    .update(domainDepthEstimates)
    .set({ generationCappedAt: capped ? new Date() : null })
    .where(eq(domainDepthEstimates.domainKey, domainKeyValue))
    .returning({ domainKey: domainDepthEstimates.domainKey });
  return rows.length > 0;
}

/**
 * The set of domain keys an admin has capped (generation_capped_at set). Read
 * once per generation round and used to drop those domains from the palette so
 * the system stops searching them for new facts. Small table, single indexed
 * scan; fail-open callers treat a throw as "nothing capped".
 */
export async function getCappedDomainKeys(): Promise<Set<string>> {
  const rows = await db
    .select({ domainKey: domainDepthEstimates.domainKey })
    .from(domainDepthEstimates)
    .where(isNotNull(domainDepthEstimates.generationCappedAt));
  return new Set(rows.map((row) => row.domainKey));
}

export type DomainSupplyCoverageRow = {
  domainKey: string;
  sampleLabel: string | null;
  estimatedQuestions: number | null;
  manualEstimatedQuestions: number | null;
  confidence: string | null;
  shape: string | null;
  basis: string | null;
  source: string;
  consecutiveDryRounds: number;
  lastYieldAt: Date | null;
  /** Admin generation cap stamp (0121); non-null = capped, excluded from generation. */
  generationCappedAt: Date | null;
  /** Distinct facts generated for the domain, bank-wide (all users). */
  realized: number;
};

/**
 * Coverage read for the supply-state machine's two surfaces (weekly digest +
 * admin dashboard, D-SUPPLY-FINITENESS-01 #5): every sized domain joined with
 * its REALIZED distinct-fact count from the shared bank. State classification
 * happens in TS (classifySupplyState) so the query stays pure observation.
 */
export async function getDomainSupplyCoverage(): Promise<DomainSupplyCoverageRow[]> {
  const realized = db.$with('realized').as(
    db
      .select({
        domainKey: generatedQuestions.domainKey,
        realized: sql<number>`count(distinct ${generatedQuestions.factKey})::int`.as('realized'),
      })
      .from(generatedQuestions)
      .where(isNotNull(generatedQuestions.factKey))
      .groupBy(generatedQuestions.domainKey),
  );
  const rows = await db
    .with(realized)
    .select({
      domainKey: domainDepthEstimates.domainKey,
      sampleLabel: domainDepthEstimates.sampleLabel,
      estimatedQuestions: domainDepthEstimates.estimatedQuestions,
      manualEstimatedQuestions: domainDepthEstimates.manualEstimatedQuestions,
      confidence: domainDepthEstimates.confidence,
      shape: domainDepthEstimates.shape,
      basis: domainDepthEstimates.basis,
      source: domainDepthEstimates.source,
      consecutiveDryRounds: domainDepthEstimates.consecutiveDryRounds,
      lastYieldAt: domainDepthEstimates.lastYieldAt,
      generationCappedAt: domainDepthEstimates.generationCappedAt,
      realized: sql<number>`coalesce(${realized.realized}, 0)::int`,
    })
    .from(domainDepthEstimates)
    .leftJoin(realized, eq(realized.domainKey, domainDepthEstimates.domainKey));
  return rows;
}
