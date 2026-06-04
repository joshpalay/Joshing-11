import type Anthropic from '@anthropic-ai/sdk';

import {
  ANTHROPIC_MODEL,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
} from '@/lib/llm';
import { db, generatedQuestions } from '@/server/db';
import { embedAndResolveDuplicate } from '@/server/pool/dedup';
import {
  GROUNDING_SYSTEM_ADDENDUM,
  SYSTEM_PROMPT,
  buildUserPrompt,
  distinctSourceHostCount,
  parseGroundedQuestions,
  screenGroundedBatch,
  type GroundedLlmQuestion,
} from '@/server/daily/generate-questions';
import { resolveDailyBasePoints } from '@/server/daily/types';
import {
  getDomainPoolAvoidLists,
  getThinActiveDomains,
} from '@/server/db/queries/retrieval-demand';
import {
  estimateCallUsd,
  getRetrievalConfig,
  type RetrievalConfig,
} from '@/server/daily/retrieval-config';

// Web search adds round-trips inside the single (server-tool) generation call,
// so it tolerates more latency than a plain generation batch. Still bounded so a
// stalled call can't eat the cron's whole budget.
const RETRIEVAL_CALL_TIMEOUT_MS = 60_000;
// Durable pool content (B1 §5.1, D8): machine bank no longer expires by age, so
// seed rows get a far-future expiry rather than the per-user daily-reset value —
// the bank ignores expiry for serving, and this keeps any age-based cleanup from
// sweeping durable seeds.
const DURABLE_EXPIRY = new Date('2999-01-01T00:00:00.000Z');
// How many existing pool facts per domain to feed the avoid list.
const AVOID_LIST_LIMIT = 60;

export type DomainRefillResult = {
  domain: string;
  persisted: number;
  webSearches: number;
  usd: number;
  generated: number;
  droppedUncorroborated: number;
  droppedQualityGate: number;
  droppedDuplicateFact: number;
};

export type PoolRefillReport = {
  enabled: boolean;
  ranAt: string;
  reason?: string;
  usdCeiling: number;
  usdSpent: number;
  webSearches: number;
  domainsConsidered: number;
  domainsProcessed: number;
  questionsPersisted: number;
  dropped: {
    uncorroborated: number;
    qualityGate: number;
    duplicateFact: number;
  };
  // Domains that wanted refill but the USD ceiling / per-run cap cut off — the
  // signal that the budget is too low for current demand.
  backlogRemaining: number;
  perDomain: DomainRefillResult[];
};

type GroundedCallResult = {
  questions: GroundedLlmQuestion[];
  webSearches: number;
  usd: number;
};

// One retrieval-grounded generation call for a single domain. Returns the parsed
// questions plus the metered cost (searches + tokens) of THIS call.
async function generateGroundedForDomain(
  client: Anthropic,
  domain: string,
  config: RetrievalConfig,
): Promise<GroundedCallResult> {
  const { questionTexts, factKeys } = await getDomainPoolAvoidLists(domain, AVOID_LIST_LIMIT);

  const userPrompt = buildUserPrompt(
    [domain],
    config.questionsPerDomain,
    questionTexts,
    factKeys,
    undefined,
  );

  const maxUses = config.maxSearchesPerQuestion * config.questionsPerDomain;
  const params = {
    model: ANTHROPIC_MODEL,
    max_tokens: 3000,
    // Low temperature: fact anchoring, not question-shape variety (§7).
    temperature: 0.2,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: GROUNDING_SYSTEM_ADDENDUM },
    ],
    messages: [{ role: 'user', content: userPrompt }],
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: maxUses }],
  } as unknown as Anthropic.MessageCreateParamsNonStreaming;

  const response = await loggedMessagesCreate(client, 'pool-refill-generate', params, {
    timeoutMs: RETRIEVAL_CALL_TIMEOUT_MS,
  });

  const usage = response.usage as
    | (Anthropic.Usage & { server_tool_use?: { web_search_requests?: number } })
    | undefined;
  const webSearches = usage?.server_tool_use?.web_search_requests ?? 0;
  const usd = estimateCallUsd({
    webSearches,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
  });

  const questions = parseGroundedQuestions(extractTextContent(response.content));
  return { questions, webSearches, usd };
}

// Generate, screen, corroborate, dedup, and persist grounded questions for one
// domain. Returns the per-domain metrics for the run report.
async function refillDomain(
  client: Anthropic,
  domain: string,
  config: RetrievalConfig,
  systemUserId: string,
): Promise<DomainRefillResult> {
  const result: DomainRefillResult = {
    domain,
    persisted: 0,
    webSearches: 0,
    usd: 0,
    generated: 0,
    droppedUncorroborated: 0,
    droppedQualityGate: 0,
    droppedDuplicateFact: 0,
  };

  const { questions, webSearches, usd } = await generateGroundedForDomain(client, domain, config);
  result.webSearches = webSearches;
  result.usd = usd;
  result.generated = questions.length;
  if (questions.length === 0) return result;

  // Corroboration floor (Drift Risk 2/3): drop anything below the distinct-host
  // threshold BEFORE the quality gates so we never persist — or even spend gate
  // calls on — an uncorroborated fresh question. Phase 2 layers reputation
  // ranking + true mirror detection on top of this minimal "≥2 distinct sites".
  const corroborated: GroundedLlmQuestion[] = [];
  for (const q of questions) {
    if (distinctSourceHostCount(q.source_refs) >= config.minCorroboratingSources) {
      corroborated.push(q);
    } else {
      result.droppedUncorroborated += 1;
    }
  }
  if (corroborated.length === 0) return result;

  // Same quality bar as the per-user path (intra-batch dupe, quality, factual,
  // answer-leak). Fails open per gate.
  const drops = await screenGroundedBatch(corroborated);
  const screened = corroborated.filter((_, i) => !drops.has(i));
  result.droppedQualityGate = corroborated.length - screened.length;
  if (screened.length === 0) return result;

  const seenFactKeys = new Set<string>();
  for (const q of screened) {
    if (q.fact_key) {
      if (seenFactKeys.has(q.fact_key)) {
        result.droppedDuplicateFact += 1;
        continue;
      }
      seenFactKeys.add(q.fact_key);
    }

    try {
      const [row] = await db
        .insert(generatedQuestions)
        .values({
          userId: systemUserId,
          canonicalSubcategory: q.canonical_subcategory,
          broadCategory: q.broad_category,
          questionText: q.question_text,
          answer: q.answer,
          explainer: q.explainer,
          difficultyEstimate: q.difficulty_estimate,
          basePoints: resolveDailyBasePoints(q.difficulty_estimate),
          factKey: q.fact_key,
          subAngles: q.sub_angles,
          sourceRefs: q.source_refs,
          expiresAt: DURABLE_EXPIRY,
          usedInQueue: false,
        })
        .returning();
      result.persisted += 1;

      // Semantic-dedup backstop (B1). Best-effort; never blocks the refill.
      await embedAndResolveDuplicate({
        id: row.id,
        origin: 'machine',
        questionText: row.questionText,
      }).catch(() => undefined);
    } catch (err) {
      console.warn('[pool-refill] persist failed', {
        domain,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

// Drive a single capped pool-refill run. Derives demand (thin + active domains),
// spends up to the USD ceiling generating corroborated questions into the shared
// pool, and returns a structured report. Never throws on per-domain failure.
export async function runPoolRefill(): Promise<PoolRefillReport> {
  const config = getRetrievalConfig();
  const report: PoolRefillReport = {
    enabled: config.enabled,
    ranAt: new Date().toISOString(),
    usdCeiling: config.dailyUsdCeiling,
    usdSpent: 0,
    webSearches: 0,
    domainsConsidered: 0,
    domainsProcessed: 0,
    questionsPersisted: 0,
    dropped: { uncorroborated: 0, qualityGate: 0, duplicateFact: 0 },
    backlogRemaining: 0,
    perDomain: [],
  };

  if (!config.enabled) {
    report.reason = 'RETRIEVAL_GROUNDING_ENABLED is not set';
    return report;
  }
  const client = getAnthropicClient();
  if (!client) {
    report.reason = 'Anthropic client unavailable (missing/invalid ANTHROPIC_API_KEY or LLM disabled)';
    return report;
  }
  if (!config.systemUserId) {
    report.reason = 'RETRIEVAL_SYSTEM_USER_ID is not set — no owning user for pool rows';
    return report;
  }

  const domains = await getThinActiveDomains({
    depthThreshold: config.poolDepthThreshold,
    activeLookbackDays: config.activeLookbackDays,
    limit: config.maxDomainsPerRun,
  });
  report.domainsConsidered = domains.length;

  // Worst-case cost of one call (all searches used) — used to stop BEFORE a call
  // that could cross the ceiling rather than after, so the cap never overshoots
  // by more than rounding. Token cost is added from the actual usage afterwards.
  const perCallWorstCaseUsd =
    config.maxSearchesPerQuestion * config.questionsPerDomain * 0.01;

  for (let i = 0; i < domains.length; i += 1) {
    if (report.usdSpent + perCallWorstCaseUsd > config.dailyUsdCeiling) {
      // Ceiling reached — everything still in the list is unserved demand.
      report.backlogRemaining = domains.length - i;
      break;
    }

    const { domain } = domains[i];
    try {
      const domainResult = await refillDomain(client, domain, config, config.systemUserId);
      report.perDomain.push(domainResult);
      report.domainsProcessed += 1;
      report.usdSpent += domainResult.usd;
      report.webSearches += domainResult.webSearches;
      report.questionsPersisted += domainResult.persisted;
      report.dropped.uncorroborated += domainResult.droppedUncorroborated;
      report.dropped.qualityGate += domainResult.droppedQualityGate;
      report.dropped.duplicateFact += domainResult.droppedDuplicateFact;
    } catch (err) {
      // A single domain failing (timeout / parse / API) must not sink the run.
      console.warn('[pool-refill] domain refill failed', {
        domain,
        error: err instanceof Error ? err.message : String(err),
      });
      report.perDomain.push({
        domain,
        persisted: 0,
        webSearches: 0,
        usd: 0,
        generated: 0,
        droppedUncorroborated: 0,
        droppedQualityGate: 0,
        droppedDuplicateFact: 0,
      });
    }
  }

  return report;
}
