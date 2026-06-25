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
 * The OpenAI numbers were confirmed June 2026 against public pricing aggregators
 * (OpenAI's own pricing page blocks automated fetch, so these weren't read from
 * the source sheet directly — glance at your OpenAI billing dashboard before
 * trusting a figure for a cost-sensitive decision). Add a row for any model you
 * pin via OPENAI_MODEL / OPENAI_GRADING_MODEL; an unknown model falls back to
 * zero cost (surfaced as "unpriced" in the readout) rather than guessing.
 *
 * Note: the OpenAI completion path (openaiCompleteJsonText) does not record cache
 * token buckets, so cacheRead/cacheWrite are inert for OpenAI rows (the readout
 * only ever multiplies them by zero). They're kept at 0 to avoid implying a
 * precision we don't track.
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

  // ── OpenAI (confirmed June 2026; cache fields inert on this path — see header) ──
  // gpt-4o — the default OPENAI_MODEL flagship.
  'gpt-4o': {
    inputPerMtok: 2.5,
    outputPerMtok: 10.0,
    cacheReadPerMtok: 0,
    cacheWritePerMtok: 0,
  },
  // gpt-4o-mini — the default OPENAI_GRADING_MODEL.
  'gpt-4o-mini': {
    inputPerMtok: 0.15,
    outputPerMtok: 0.6,
    cacheReadPerMtok: 0,
    cacheWritePerMtok: 0,
  },
  // gpt-4.1 — cheaper than gpt-4o and flagship-tier; the fair-comparison swap.
  'gpt-4.1': {
    inputPerMtok: 2.0,
    outputPerMtok: 8.0,
    cacheReadPerMtok: 0,
    cacheWritePerMtok: 0,
  },
  // gpt-4.1-mini — ~84% cheaper than gpt-4o on a generation-shaped workload; the
  // cost/quality sweet spot if a strict Sonnet benchmark isn't the goal.
  'gpt-4.1-mini': {
    inputPerMtok: 0.4,
    outputPerMtok: 1.6,
    cacheReadPerMtok: 0,
    cacheWritePerMtok: 0,
  },
  // gpt-4.1-nano — cheapest; lowest quality.
  'gpt-4.1-nano': {
    inputPerMtok: 0.1,
    outputPerMtok: 0.4,
    cacheReadPerMtok: 0,
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
