/**
 * Per-model list pricing for the LLM provider A/B cost rollup
 * (B-LLM-PROVIDER-AB-METRICS, Part 2).
 *
 * Cost is computed at read time (not stored on LlmUsageEvent rows) so a price
 * change needs no backfill — update the numbers here and historical rows reprice
 * automatically. Prices are USD per 1,000,000 tokens.
 *
 * The Anthropic numbers are list prices verified against the claude-api skill's
 * model table (2026-06). Cache reads bill at ~0.1x the base input rate; 5-minute
 * cache writes at ~1.25x — the two cache_* token buckets on LlmUsageEvent are
 * priced with those multipliers below.
 *
 * The OpenAI numbers are best-effort defaults for the two models the switch
 * defaults to (OPENAI_MODEL=gpt-4o, OPENAI_GRADING_MODEL=gpt-4o-mini). They are
 * NOT verified against a live OpenAI price sheet here — VERIFY against current
 * OpenAI pricing before trusting the OpenAI dollar figures, and add a row for any
 * model you pin via OPENAI_MODEL / OPENAI_GRADING_MODEL. An unknown model falls
 * back to zero cost (and is surfaced as such in the readout) rather than guessing.
 */

export type ModelPrice = {
  /** USD per 1M input (uncached) tokens. */
  inputPerMtok: number;
  /** USD per 1M output tokens. */
  outputPerMtok: number;
  /** USD per 1M cache-read tokens (~0.1x input for Anthropic; 0 where N/A). */
  cacheReadPerMtok: number;
  /** USD per 1M cache-write tokens (~1.25x input for Anthropic 5m TTL; 0 where N/A). */
  cacheWritePerMtok: number;
};

// Keyed by the exact model string passed to the provider SDK.
export const MODEL_PRICING: Record<string, ModelPrice> = {
  // ── Anthropic (verified, claude-api skill model table) ──
  // Sonnet 4.6 — generation.
  'claude-sonnet-4-6': {
    inputPerMtok: 3.0,
    outputPerMtok: 15.0,
    cacheReadPerMtok: 0.3, // ~0.1x input
    cacheWritePerMtok: 3.75, // ~1.25x input (5m TTL)
  },
  // Haiku 4.5 — grading + categorization.
  'claude-haiku-4-5-20251001': {
    inputPerMtok: 1.0,
    outputPerMtok: 5.0,
    cacheReadPerMtok: 0.1,
    cacheWritePerMtok: 1.25,
  },

  // ── OpenAI (UNVERIFIED defaults — confirm against current OpenAI pricing) ──
  // gpt-4o — flagship surfaces (generation/categorization/suggestion).
  'gpt-4o': {
    inputPerMtok: 2.5,
    outputPerMtok: 10.0,
    cacheReadPerMtok: 1.25, // gpt-4o cached input (~0.5x); no separate write charge
    cacheWritePerMtok: 0,
  },
  // gpt-4o-mini — grading.
  'gpt-4o-mini': {
    inputPerMtok: 0.15,
    outputPerMtok: 0.6,
    cacheReadPerMtok: 0.075,
    cacheWritePerMtok: 0,
  },
};

export type UsageTokens = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
};

export type CostEstimate = {
  /** Total estimated USD, or null when the model isn't in MODEL_PRICING. */
  usd: number | null;
  /** True when the model has no price row — the dollar figure is unknown, not zero. */
  unpriced: boolean;
};

/**
 * Estimate the USD cost of a single call's token usage. Returns `unpriced: true`
 * (and `usd: null`) for a model absent from MODEL_PRICING so the readout can show
 * "tokens known, $ unknown" rather than a misleading $0.
 */
export function estimateCostUsd(model: string, tokens: UsageTokens): CostEstimate {
  const price = MODEL_PRICING[model];
  if (!price) return { usd: null, unpriced: true };
  const usd =
    (tokens.inputTokens / 1_000_000) * price.inputPerMtok +
    (tokens.outputTokens / 1_000_000) * price.outputPerMtok +
    (tokens.cacheReadTokens / 1_000_000) * price.cacheReadPerMtok +
    (tokens.cacheCreateTokens / 1_000_000) * price.cacheWritePerMtok;
  return { usd, unpriced: false };
}
