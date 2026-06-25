/**
 * Read/write layer for the LLM provider A/B experiment metrics
 * (B-LLM-PROVIDER-AB-METRICS). Three concerns, one removable unit:
 *
 *   Part 1 (quality)  — readGradingQualityByProvider / readGenerationByProvider
 *   Part 2 (cost)     — recordLlmUsage (write) / readUsageCostByProvider (read)
 *   Part 3 (flip log) — writeProviderChanges (write) / readRecentProviderChanges
 *
 * Every write path here is best-effort: telemetry and audit rows must never block
 * or fail an LLM completion or a provider flip. Reads are owner-only (gated at the
 * page/route that calls them), windowed by `days` where a time window is meaningful.
 */
import { and, desc, gte, isNotNull, sql } from 'drizzle-orm';

import { db, generatedQuestions, llmProviderChangeLog, llmUsageEvent, masteryEvents } from '@/server/db';
import { estimateCostUsd, type CostEstimate } from '@/server/llm/pricing';
import type { LlmProvider } from '@/server/llm/provider';
import type { ProviderSurface } from '@/server/llm/settings';

// ─── Part 2: cost — write ────────────────────────────────────────────────────

export type LlmUsageRecord = {
  scope: string;
  provider: LlmProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreateTokens?: number;
  durationMs?: number;
};

/**
 * Record one LLM call's token usage. Best-effort and self-contained — swallows
 * its own errors so a telemetry write can never turn a successful completion into
 * a failure. Callers fire-and-forget: `void recordLlmUsage({...})`.
 */
export async function recordLlmUsage(event: LlmUsageRecord): Promise<void> {
  try {
    await db.insert(llmUsageEvent).values({
      scope: event.scope,
      provider: event.provider,
      model: event.model,
      inputTokens: Math.max(0, Math.round(event.inputTokens || 0)),
      outputTokens: Math.max(0, Math.round(event.outputTokens || 0)),
      cacheReadTokens: Math.max(0, Math.round(event.cacheReadTokens || 0)),
      cacheCreateTokens: Math.max(0, Math.round(event.cacheCreateTokens || 0)),
      durationMs: event.durationMs != null ? Math.max(0, Math.round(event.durationMs)) : null,
    });
  } catch (error) {
    console.warn('[llm/usage] recordLlmUsage failed (telemetry only)', {
      scope: event.scope,
      provider: event.provider,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

// ─── Part 2: cost — read ─────────────────────────────────────────────────────

export type ProviderModelCost = {
  provider: LlmProvider;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  cost: CostEstimate;
};

/**
 * Token usage grouped by provider + model over the last `days`, with the USD cost
 * derived from the price map. Rows whose model has no price row come back with
 * `cost.unpriced === true` (dollar figure unknown, not zero).
 */
export async function readUsageCostByProvider(days = 14): Promise<ProviderModelCost[]> {
  const rows = await db
    .select({
      provider: llmUsageEvent.provider,
      model: llmUsageEvent.model,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${llmUsageEvent.inputTokens}), 0)::float8`,
      outputTokens: sql<number>`coalesce(sum(${llmUsageEvent.outputTokens}), 0)::float8`,
      cacheReadTokens: sql<number>`coalesce(sum(${llmUsageEvent.cacheReadTokens}), 0)::float8`,
      cacheCreateTokens: sql<number>`coalesce(sum(${llmUsageEvent.cacheCreateTokens}), 0)::float8`,
    })
    .from(llmUsageEvent)
    .where(gte(llmUsageEvent.createdAt, sql`now() - make_interval(days => ${days})`))
    .groupBy(llmUsageEvent.provider, llmUsageEvent.model)
    .orderBy(llmUsageEvent.provider, llmUsageEvent.model);

  return rows.map((r) => ({
    provider: r.provider as LlmProvider,
    model: r.model,
    calls: Number(r.calls),
    inputTokens: Number(r.inputTokens),
    outputTokens: Number(r.outputTokens),
    cacheReadTokens: Number(r.cacheReadTokens),
    cacheCreateTokens: Number(r.cacheCreateTokens),
    cost: estimateCostUsd(r.model, {
      inputTokens: Number(r.inputTokens),
      outputTokens: Number(r.outputTokens),
      cacheReadTokens: Number(r.cacheReadTokens),
      cacheCreateTokens: Number(r.cacheCreateTokens),
    }),
  }));
}

// ─── Part 1: quality — grading ───────────────────────────────────────────────

export type GradingQualityByProvider = {
  provider: LlmProvider;
  graded: number;
  wrong: number;
  /** Share of graded answers marked incorrect, 0..1, or null when graded === 0. */
  wrongRate: number | null;
};

/**
 * Wrong-answer rate per GRADING provider over the last `days` — the experiment's
 * north-star. Only counts MASTERY_EVENTS rows that an LLM actually graded
 * (llm_provider not null) and that carry a scored answer_state. `answer_state`
 * value 'incorrect' is the wrong case; the other three are correct.
 */
export async function readGradingQualityByProvider(days = 14): Promise<GradingQualityByProvider[]> {
  const rows = await db
    .select({
      provider: masteryEvents.llmProvider,
      graded: sql<number>`count(*)::int`,
      wrong: sql<number>`(count(*) filter (where ${masteryEvents.answerState} = 'incorrect'))::int`,
    })
    .from(masteryEvents)
    .where(
      and(
        isNotNull(masteryEvents.llmProvider),
        isNotNull(masteryEvents.answerState),
        gte(masteryEvents.createdAt, sql`now() - make_interval(days => ${days})`),
      ),
    )
    .groupBy(masteryEvents.llmProvider)
    .orderBy(masteryEvents.llmProvider);

  return rows.map((r) => {
    const graded = Number(r.graded);
    const wrong = Number(r.wrong);
    return {
      provider: r.provider as LlmProvider,
      graded,
      wrong,
      wrongRate: graded > 0 ? wrong / graded : null,
    };
  });
}

// ─── Part 1: quality — generation ────────────────────────────────────────────

export type GenerationByProvider = {
  provider: LlmProvider;
  questions: number;
  /** Mean empirical correct rate of generated questions that have been played, or null. */
  avgEmpiricalCorrectRate: number | null;
};

/**
 * Question counts per GENERATING provider, with the mean empirical correct rate
 * (a downstream quality proxy: questions a provider wrote that real players got
 * right). All-time over stamped rows — generation provenance only exists post-B3,
 * so there is no pre-experiment noise to window out.
 */
export async function readGenerationByProvider(): Promise<GenerationByProvider[]> {
  const rows = await db
    .select({
      provider: generatedQuestions.generatedByProvider,
      questions: sql<number>`count(*)::int`,
      avgEmpiricalCorrectRate: sql<number | null>`avg(${generatedQuestions.empiricalCorrectRate})::float8`,
    })
    .from(generatedQuestions)
    .where(isNotNull(generatedQuestions.generatedByProvider))
    .groupBy(generatedQuestions.generatedByProvider)
    .orderBy(generatedQuestions.generatedByProvider);

  return rows.map((r) => ({
    provider: r.provider as LlmProvider,
    questions: Number(r.questions),
    avgEmpiricalCorrectRate: r.avgEmpiricalCorrectRate != null ? Number(r.avgEmpiricalCorrectRate) : null,
  }));
}

// ─── Part 3: flip log — write ────────────────────────────────────────────────

export type ProviderChange = {
  surface: ProviderSurface;
  from: LlmProvider;
  to: LlmProvider;
};

/**
 * Append one flip-log row per surface that actually changed. Best-effort — a
 * failed audit write must never block the provider change that already landed.
 */
export async function writeProviderChanges(
  changes: ProviderChange[],
  changedByUserId: string | null,
): Promise<void> {
  if (changes.length === 0) return;
  try {
    await db.insert(llmProviderChangeLog).values(
      changes.map((c) => ({
        surface: c.surface,
        fromProvider: c.from,
        toProvider: c.to,
        changedByUserId,
      })),
    );
  } catch (error) {
    console.warn('[llm/flip-log] writeProviderChanges failed (audit only)', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

// ─── Part 3: flip log — read ─────────────────────────────────────────────────

export type ProviderChangeRow = {
  surface: string;
  fromProvider: LlmProvider;
  toProvider: LlmProvider;
  changedByUserId: string | null;
  createdAt: Date;
};

/** The most recent `limit` provider flips, newest first. */
export async function readRecentProviderChanges(limit = 10): Promise<ProviderChangeRow[]> {
  const rows = await db
    .select({
      surface: llmProviderChangeLog.surface,
      fromProvider: llmProviderChangeLog.fromProvider,
      toProvider: llmProviderChangeLog.toProvider,
      changedByUserId: llmProviderChangeLog.changedByUserId,
      createdAt: llmProviderChangeLog.createdAt,
    })
    .from(llmProviderChangeLog)
    .orderBy(desc(llmProviderChangeLog.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    surface: r.surface,
    fromProvider: r.fromProvider as LlmProvider,
    toProvider: r.toProvider as LlmProvider,
    changedByUserId: r.changedByUserId,
    createdAt: r.createdAt,
  }));
}
