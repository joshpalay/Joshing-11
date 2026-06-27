// Server-configurable knobs for B3 retrieval-grounded pool refill.
//
// Everything here is read from the environment with a SAFE, LOW default so the
// feature is off (and cheap) until an operator deliberately turns it on. The
// daily USD ceiling is a hard runaway guard, not a target: the batch derives
// demand (thin + active domains) and usually spends far less. See PRD-D-5 §5.3 /
// §7 and the B3 build prompt's cost gate.

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

export type RetrievalConfig = {
  /** Master switch. Off by default — the batch no-ops until enabled. */
  enabled: boolean;
  /** Owning user id for batch-generated pool rows (generatedQuestions.userId is
   *  a NOT NULL FK; pickBankSource serves rows where userId <> viewer, so a
   *  dedicated account becomes pool fodder for everyone else). No-op if unset. */
  systemUserId: string | null;
  /** Hard ceiling on retrieval spend per cron run, in USD. Stops issuing new
   *  retrieval calls once the next call's worst case would cross it. */
  dailyUsdCeiling: number;
  /** Hard MONTHLY ceiling on total LLM spend, in USD. When month-to-date LLM cost
   *  (from the LlmUsageEvent ledger) crosses this, the grounding run no-ops — a
   *  belt-and-suspenders cap on discretionary spend above the per-run ceiling.
   *  0/unset disables it. The Anthropic Console org spend limit is the hard,
   *  platform-level global backstop that also covers per-user generation. */
  monthlyUsdCeiling: number;
  /** Searches the model may run per generated question (maps to web_search
   *  max_uses, multiplied by questions-per-call). */
  maxSearchesPerQuestion: number;
  /** How many questions to ask for per domain in a single grounded call. */
  questionsPerDomain: number;
  /** A domain is "thin" (eligible for refill) when its durable pool depth — the
   *  count of non-duplicate, fact-keyed machine rows — is below this. */
  poolDepthThreshold: number;
  /** "Active" lookback: a domain qualifies only if it saw machine-pool activity
   *  within this many days (a proxy for real users being served it). */
  activeLookbackDays: number;
  /** Cap on domains processed in a single run (belt-and-braces alongside the
   *  USD ceiling). */
  maxDomainsPerRun: number;
  /** Minimum distinct non-denied source hosts required to keep a grounded
   *  question (corroboration floor; Drift Risk 2). */
  minCorroboratingSources: number;
  /** Of the corroborating sources, how many must be editorially-accountable
   *  (allow-listed / .edu / .gov / .mil / .ac.*). Default 1 — set equal to
   *  minCorroboratingSources for the strict "all reputable" reading. */
  minReputableSources: number;
};

// Anthropic server-side web search billing: ~$10 / 1,000 searches.
export const USD_PER_WEB_SEARCH = 0.01;
// claude-sonnet-4-6 token pricing (USD per token) for the spend estimate. Input
// includes the retrieved-source tokens the search tool injects.
export const USD_PER_INPUT_TOKEN = 3 / 1_000_000;
export const USD_PER_OUTPUT_TOKEN = 15 / 1_000_000;
export const USD_PER_CACHE_READ_TOKEN = 0.3 / 1_000_000;
export const USD_PER_CACHE_WRITE_TOKEN = 3.75 / 1_000_000;

export function getRetrievalConfig(): RetrievalConfig {
  return {
    enabled: boolEnv('RETRIEVAL_GROUNDING_ENABLED', false),
    systemUserId: process.env.RETRIEVAL_SYSTEM_USER_ID?.trim() || null,
    dailyUsdCeiling: numEnv('RETRIEVAL_DAILY_USD_CEILING', 2),
    monthlyUsdCeiling: numEnv('LLM_MONTHLY_USD_CEILING', 0),
    maxSearchesPerQuestion: Math.max(1, Math.round(numEnv('RETRIEVAL_MAX_SEARCHES_PER_QUESTION', 3))),
    questionsPerDomain: Math.max(1, Math.round(numEnv('RETRIEVAL_QUESTIONS_PER_DOMAIN', 3))),
    poolDepthThreshold: Math.max(1, Math.round(numEnv('RETRIEVAL_POOL_DEPTH_THRESHOLD', 8))),
    activeLookbackDays: Math.max(1, Math.round(numEnv('RETRIEVAL_ACTIVE_LOOKBACK_DAYS', 14))),
    maxDomainsPerRun: Math.max(1, Math.round(numEnv('RETRIEVAL_MAX_DOMAINS_PER_RUN', 50))),
    minCorroboratingSources: Math.max(1, Math.round(numEnv('RETRIEVAL_MIN_CORROBORATING_SOURCES', 2))),
    minReputableSources: Math.max(1, Math.round(numEnv('RETRIEVAL_MIN_REPUTABLE_SOURCES', 1))),
  };
}

// Convert an Anthropic usage object + web-search count into an estimated USD
// cost. Used both to enforce the ceiling and to populate the run report.
export function estimateCallUsd(args: {
  webSearches: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}): number {
  return (
    args.webSearches * USD_PER_WEB_SEARCH +
    args.inputTokens * USD_PER_INPUT_TOKEN +
    args.outputTokens * USD_PER_OUTPUT_TOKEN +
    args.cacheReadTokens * USD_PER_CACHE_READ_TOKEN +
    args.cacheWriteTokens * USD_PER_CACHE_WRITE_TOKEN
  );
}
