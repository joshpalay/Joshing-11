import type Anthropic from '@anthropic-ai/sdk';

import {
  ANTHROPIC_MODEL,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
} from '@/lib/llm';
import { db, generatedQuestions } from '@/server/db';
import { domainKey } from '@/lib/knowledge/domain-key';
import { embedAndResolveDuplicate } from '@/server/pool/dedup';
import {
  GROUNDING_SYSTEM_ADDENDUM,
  SYSTEM_PROMPT,
  buildUserPrompt,
  parseGroundedQuestions,
  screenGroundedBatch,
  type GroundedLlmQuestion,
} from '@/server/daily/generate-questions';
import { askToAnswerBatch, resolveMachineTrustTier } from '@/server/daily/ask-to-answer';
import { enrichAcceptableVariants, mergeVariants } from '@/server/daily/enrich-variants';
import { runBudgetedConcurrent } from '@/server/daily/budgeted-concurrency';
import { getMonthToDateLlmSpendUsd } from '@/server/db/queries/llm-provider-experiment';
import { assessCorroboration, getReputationLists } from '@/server/daily/source-reputation';
import { resolveDailyBasePoints } from '@/server/daily/types';
import {
  getDomainPoolAvoidLists,
  getThinActiveDomains,
} from '@/server/db/queries/retrieval-demand';
import {
  USD_PER_WEB_SEARCH,
  estimateCallUsd,
  getRetrievalConfig,
  type RetrievalConfig,
} from '@/server/daily/retrieval-config';

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
  // True when this was a preview: demand derived + spend projected, but no
  // searches issued and nothing persisted. usdSpent/webSearches are projections.
  dryRun: boolean;
  ranAt: string;
  reason?: string;
  usdCeiling: number;
  usdSpent: number;
  // Month-to-date total LLM spend (USD) checked against LLM_MONTHLY_USD_CEILING,
  // when that cap is configured; undefined when the monthly cap is disabled.
  monthToDateUsd?: number;
  monthlyUsdCeiling?: number;
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

  // Web search adds round-trips inside the single (server-tool) generation call,
  // so it tolerates more latency than a plain batch. Configurable + bounded
  // (config.callTimeoutMs) so a stalled call can't eat the cron's whole budget,
  // but isn't so tight that every domain aborts (the 2026-06 outage).
  const response = await loggedMessagesCreate(client, 'pool-refill-generate', params, {
    timeoutMs: config.callTimeoutMs,
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

  // Corroboration + reputation gate (Phase 2; DR2/DR3): drop anything not backed
  // by ≥minCorroboratingSources independent non-denied hosts with
  // ≥minReputableSources editorially-accountable anchors, BEFORE the quality
  // gates — so we never persist (or spend gate calls on) an uncorroborated fresh
  // question, and circular/junk sources can't fake corroboration. Surviving
  // questions keep only their non-denied refs, reputable-first.
  const lists = getReputationLists();
  const corroborated: GroundedLlmQuestion[] = [];
  for (const q of questions) {
    const assessment = assessCorroboration(q.source_refs, {
      minTotal: config.minCorroboratingSources,
      minReputable: config.minReputableSources,
      lists,
    });
    if (assessment.corroborated) {
      corroborated.push({ ...q, source_refs: assessment.orderedRefs });
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

  // Ask-to-answer secondary net (B4 Phase 1 / §5.3 layer 2): even corroborated
  // grounded questions get the cold-solver check — its job is to catch the model
  // MISREADING its own retrieved source. A clear contradiction drops the row;
  // otherwise the row keeps its corroborated → machine_verified entry tier.
  const askResult = await askToAnswerBatch(
    screened.map((q) => ({ questionText: q.question_text, answer: q.answer })),
  );
  result.droppedQualityGate += askResult.toDrop.size;

  // Answer-key enrichment (Fix 3): additional genuinely-correct answers for
  // multi-answer questions, merged into acceptable_variants below. Fail-open.
  const enrichByIndex = await enrichAcceptableVariants(
    screened.map((q) => ({ questionText: q.question_text, answer: q.answer, explainer: q.explainer })),
  );

  const seenFactKeys = new Set<string>();
  for (let i = 0; i < screened.length; i += 1) {
    const q = screened[i];
    if (askResult.toDrop.has(i)) continue;
    if (q.fact_key) {
      if (seenFactKeys.has(q.fact_key)) {
        result.droppedDuplicateFact += 1;
        continue;
      }
      seenFactKeys.add(q.fact_key);
    }

    // Corroborated by construction (passed the corroboration gate above), so the
    // row enters machine_verified regardless of the ask-to-answer outcome; the
    // ask-to-answer flag is still recorded for provenance.
    const askToAnswerVerified = askResult.verified.has(i);
    const trustTier = resolveMachineTrustTier({ askToAnswerVerified, corroborated: true });
    try {
      const [row] = await db
        .insert(generatedQuestions)
        .values({
          userId: systemUserId,
          canonicalSubcategory: q.canonical_subcategory,
          // Folded lookup key (BP-7 / C5) — all pool write paths set this.
          domainKey: domainKey(q.canonical_subcategory),
          broadCategory: q.broad_category,
          questionText: q.question_text,
          answer: q.answer,
          explainer: q.explainer,
          difficultyEstimate: q.difficulty_estimate,
          basePoints: resolveDailyBasePoints(q.difficulty_estimate),
          factKey: q.fact_key,
          subAngles: q.sub_angles,
          sourceRefs: q.source_refs,
          trustTier,
          askToAnswerVerified,
          acceptableVariants: mergeVariants(
            askResult.variantsByIndex.get(i),
            enrichByIndex.get(i),
          ),
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
        factKey: row.factKey ?? null,
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
export async function runPoolRefill(opts: { dryRun?: boolean } = {}): Promise<PoolRefillReport> {
  const dryRun = opts.dryRun ?? false;
  const config = getRetrievalConfig();
  const report: PoolRefillReport = {
    enabled: config.enabled,
    dryRun,
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

  const client = getAnthropicClient();

  // A real run requires all three preconditions; a dry run previews regardless
  // (that's its purpose — sanity-check demand BEFORE flipping the switches) and
  // just records which precondition would block the real run.
  const blockers: string[] = [];
  if (!config.enabled) blockers.push('RETRIEVAL_GROUNDING_ENABLED is not set');
  if (!client) blockers.push('Anthropic client unavailable (missing/invalid ANTHROPIC_API_KEY or LLM disabled)');
  if (!config.systemUserId) blockers.push('RETRIEVAL_SYSTEM_USER_ID is not set — no owning user for pool rows');

  // Monthly spend cap. A hard stop on the discretionary grounding spend once
  // month-to-date LLM cost crosses LLM_MONTHLY_USD_CEILING — belt-and-suspenders
  // above the per-run dailyUsdCeiling. 0/unset disables it. (The Anthropic Console
  // org spend limit is the platform-level global backstop that also bounds
  // per-user generation.) A dry run still reports the numbers but, like the other
  // blockers, only a real run hard-returns on it.
  if (config.monthlyUsdCeiling > 0) {
    const monthToDateUsd = await getMonthToDateLlmSpendUsd();
    report.monthToDateUsd = monthToDateUsd;
    report.monthlyUsdCeiling = config.monthlyUsdCeiling;
    if (monthToDateUsd >= config.monthlyUsdCeiling) {
      blockers.push(
        `month-to-date LLM spend $${monthToDateUsd.toFixed(2)} >= LLM_MONTHLY_USD_CEILING $${config.monthlyUsdCeiling.toFixed(2)}`,
      );
    }
  }

  if (blockers.length > 0) {
    report.reason = blockers.join('; ');
    if (!dryRun) return report;
  }

  const domains = await getThinActiveDomains({
    depthThreshold: config.poolDepthThreshold,
    activeLookbackDays: config.activeLookbackDays,
    limit: config.maxDomainsPerRun,
  });
  report.domainsConsidered = domains.length;

  // Worst-case search cost of one call (all max_uses searches) — used to stop
  // BEFORE a call that could cross the ceiling rather than after, so the cap
  // never overshoots by more than rounding. Token cost is added from actual
  // usage afterwards (and is NOT projected in a dry run — flagged in the route).
  const maxSearchesPerCall = config.maxSearchesPerQuestion * config.questionsPerDomain;
  const perCallWorstCaseUsd = maxSearchesPerCall * USD_PER_WEB_SEARCH;

  // Fold one settled domain (success or failure) into the run report. In the real
  // path this runs over the worker results AFTER they settle (not concurrently),
  // so the report totals are assembled in one pass.
  const accumulate = (r: DomainRefillResult): void => {
    report.perDomain.push(r);
    report.domainsProcessed += 1;
    report.usdSpent += r.usd;
    report.webSearches += r.webSearches;
    report.questionsPersisted += r.persisted;
    report.dropped.uncorroborated += r.droppedUncorroborated;
    report.dropped.qualityGate += r.droppedQualityGate;
    report.dropped.duplicateFact += r.droppedDuplicateFact;
  };

  if (dryRun) {
    // Preview only: project each call's worst-case search spend sequentially,
    // issue nothing, and stop at the ceiling like a real run would.
    for (let i = 0; i < domains.length; i += 1) {
      if (report.usdSpent + perCallWorstCaseUsd > config.dailyUsdCeiling) {
        report.backlogRemaining = domains.length - i;
        break;
      }
      accumulate({
        domain: domains[i].domain,
        persisted: 0,
        webSearches: maxSearchesPerCall,
        usd: perCallWorstCaseUsd,
        generated: 0,
        droppedUncorroborated: 0,
        droppedQualityGate: 0,
        droppedDuplicateFact: 0,
      });
    }
    return report;
  }

  // Real run. Preconditions are guaranteed by the blocker early-return above;
  // narrow them here for the type checker (and stay defensive).
  if (!client || !config.systemUserId) return report;
  const liveClient = client;
  const systemUserId = config.systemUserId;

  // Bounded-concurrency domain processing (B-SUPPLY-REFILL-THROUGHPUT-01). A
  // sequential run drained only ~2-3 domains inside the route's 300s budget and
  // slow domains starved (verification 2026-06-30, ~65% of domains time out at
  // callTimeoutMs). Running a few at once keeps the budget productive.
  const { results, backlog } = await runBudgetedConcurrent(
    domains.map((d) => d.domain),
    {
      concurrency: config.maxConcurrentDomains,
      perItemReservation: perCallWorstCaseUsd,
      ceiling: config.dailyUsdCeiling,
      costOf: (r: DomainRefillResult) => r.usd,
    },
    (domain) => refillDomain(liveClient, domain, config, systemUserId),
    (domain, err): DomainRefillResult => {
      // A single domain failing (timeout / parse / API) must not sink the run.
      console.warn('[pool-refill] domain refill failed', {
        domain,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        domain,
        persisted: 0,
        webSearches: 0,
        usd: 0,
        generated: 0,
        droppedUncorroborated: 0,
        droppedQualityGate: 0,
        droppedDuplicateFact: 0,
      };
    },
  );
  results.forEach(accumulate);
  report.backlogRemaining = backlog;

  return report;
}
