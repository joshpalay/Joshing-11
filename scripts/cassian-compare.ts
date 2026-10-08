/**
 * Cassian's bounded, sequential comparison runner.
 *   npx tsx scripts/cassian-compare.ts                 # no network or paid calls
 *   npx tsx scripts/cassian-compare.ts --run --topics 3
 *   npx tsx scripts/cassian-compare.ts --resume --topics 3
 * A run requires migration 0151 and DATABASE_URL + ANTHROPIC_API_KEY. The
 * private checkpoint is ignored under _scratch/Cassian/<manifest id>/.
 * Set CASSIAN_SOURCE_CHECKPOINT_FILE to reuse frozen reference packets, and
 * CASSIAN_PRIOR_STATE_FILE to provide the same prior-fact snapshot to both arms.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import type { LlmQuestion } from '../src/server/daily/generate-questions';
import type { DomainReference } from '../src/server/daily/domain-reference';
import { FACTUAL_GATE_MODEL, QUALITY_GATE_MODEL, SOURCE_MODEL } from './cassian-models';
import { domainKey } from '../src/lib/knowledge/domain-key';
import { estimateCostUsd } from '../src/server/llm/pricing';
import {
  acquireRunnerLock, closeBudgetPool, getBudgetStatus, reserveCall, settleCall,
} from '../src/server/cassian/budget';

// Generation imports initialize the normal DB pool. Load environment first,
// and do not import them at all for the free default estimate mode.
let llmApi: typeof import('../src/lib/llm') | null = null;
let generationApi: typeof import('../src/server/daily/generate-questions') | null = null;
let unlockRunner: (() => Promise<void>) | null = null;

type Topic = { domain: string; breadth: 'broad' | 'niche' | 'very narrow'; difficulty: string };
type Manifest = { id: string; topics: Topic[]; arms: { id: string; model: string }[] };
type CallResult = {
  model: string; requestId: string | null; raw: string; stopReason: string | null;
  elapsedMs: number; usd: number; usage: {
    inputTokens: number; outputTokens: number; cacheReadTokens: number;
    cacheCreateTokens: number; webSearchRequests: number;
  };
};
type Checkpoint = {
  manifestSha: string; calls: Record<string, CallResult>;
  candidates: Record<string, { question: LlmQuestion | null; status: string; checks: Record<string, unknown> }>;
};
type PriorEntry = { text: string; factKey?: string | null };

const manifestPath = resolve(process.env.CASSIAN_MANIFEST_FILE || 'Cassian/manifest.json');
const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString('utf8')) as Manifest;
const manifestSha = createHash('sha256').update(manifestBytes).digest('hex');
const privateDir = resolve('_scratch/Cassian', manifest.id);
const checkpointPath = resolve(privateDir, 'checkpoint.json');
const args = process.argv.slice(2);
const paidMode = args.includes('--run') || args.includes('--resume');
if (paidMode && !process.env.CASSIAN_MANIFEST_FILE) {
  throw new Error('Paid Cassian runs require CASSIAN_MANIFEST_FILE pointing to the private frozen manifest.');
}
const requestedIndex = args.indexOf('--topics');
const requestedTopics = requestedIndex >= 0 ? Number(args[requestedIndex + 1]) : 3;

function balancedTopics(count: number): Topic[] {
  if (!Number.isInteger(count) || count < 3 || count > 12 || count % 3 !== 0) {
    throw new Error('--topics must be 3, 6, 9, or 12 (balanced across breadth).');
  }
  const groups = ['broad', 'niche', 'very narrow'].map((breadth) =>
    manifest.topics.filter((topic) => topic.breadth === breadth));
  if (groups.some((group) => group.length !== 4)) throw new Error('Manifest breadth groups changed.');
  const selected: Topic[] = [];
  for (let i = 0; i < count / 3; i += 1) for (const group of groups) selected.push(group[i]);
  return selected;
}

function save(checkpoint: Checkpoint): void {
  mkdirSync(privateDir, { recursive: true });
  const temp = `${checkpointPath}.tmp`;
  writeFileSync(temp, JSON.stringify(checkpoint, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, checkpointPath);
}

function load(): Checkpoint {
  if (!existsSync(checkpointPath)) return { manifestSha, calls: {}, candidates: {} };
  const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as Checkpoint;
  if (checkpoint.manifestSha !== manifestSha) throw new Error('Private checkpoint manifest mismatch.');
  return checkpoint;
}

function loadEnv(): void {
  const path = process.env.CASSIAN_ENV_FILE || '.env.local';
  dotenv.config({ path, quiet: true });
  if (!process.env.DATABASE_URL || !process.env.ANTHROPIC_API_KEY) {
    throw new Error('DATABASE_URL and ANTHROPIC_API_KEY are required for paid mode.');
  }
}

async function call(
  checkpoint: Checkpoint,
  client: Anthropic,
  key: string,
  reserveUsd: number,
  params: Anthropic.MessageCreateParamsNonStreaming,
  timeoutMs: number,
): Promise<CallResult> {
  const reservation = await reserveCall({
    runId: manifest.id, manifestSha, key, reserveUsd,
  });
  if (reservation === 'already_done') {
    const prior = checkpoint.calls[key];
    if (!prior) throw new Error(`Ledger says ${key} completed but private checkpoint is missing. Stop; do not repeat.`);
    return prior;
  }
  const started = Date.now();
  let result: CallResult;
  try {
    if (!llmApi) throw new Error('LLM helpers not initialized.');
    const response = await client.messages.create(llmApi.sanitizeParamsForModel(params), {
      signal: AbortSignal.timeout(timeoutMs),
      maxRetries: 0,
    });
    const usage = response.usage as typeof response.usage & {
      server_tool_use?: { web_search_requests?: number };
    };
    const tokenUsage = {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheCreateTokens: usage.cache_creation_input_tokens ?? 0,
      webSearchRequests: usage.server_tool_use?.web_search_requests ?? 0,
    };
    const cost = estimateCostUsd(response.model, tokenUsage);
    if (cost.usd === null) throw new Error(`Unknown price for response model ${response.model}; reservation retained.`);
    result = {
      model: response.model,
      requestId: (response as { _request_id?: string })._request_id ?? null,
      raw: llmApi.extractTextContent(response.content), stopReason: response.stop_reason,
      elapsedMs: Date.now() - started, usd: cost.usd, usage: tokenUsage,
    };
    checkpoint.calls[key] = result;
    save(checkpoint); // Content is durable before releasing the budget claim.
  } catch (error) {
    // A provider timeout can still be billed. Keep the whole reservation and
    // refuse an automatic retry; explicit reconciliation is required.
    await settleCall({ runId: manifest.id, key, actualUsd: null,
      reason: error instanceof Error ? error.message.slice(0, 250) : 'unknown failure' });
    throw error;
  }
  // Settlement is outside the call-error catch: if the database update fails,
  // preserve the reserved step and stop. A retry would risk a duplicate charge.
  await settleCall({ runId: manifest.id, key, actualUsd: result.usd });
  console.log(`${key}: ${result.elapsedMs} ms, $${result.usd.toFixed(4)}`);
  return result;
}

function parseGate(raw: string): { drop: boolean; reason: string | null; valid: boolean } {
  if (!llmApi || !generationApi) throw new Error('Gate helpers not initialized.');
  const parsed = llmApi.parseJsonObject(raw);
  if (!parsed || !Array.isArray(parsed.drop_indices) ||
    !parsed.reasons || typeof parsed.reasons !== 'object' || Array.isArray(parsed.reasons)) {
    return { drop: true, reason: 'unparseable verdict; held for review', valid: false };
  }
  const verdict = generationApi.parseFactualGateResponse(raw, 1);
  return { drop: verdict.toDrop.has(0), reason: verdict.reasons[0] ?? null, valid: true };
}

async function run(): Promise<void> {
  const topics = balancedTopics(requestedTopics);
  const savedSourcePath = process.env.CASSIAN_SOURCE_CHECKPOINT_FILE;
  const priorStatePath = process.env.CASSIAN_PRIOR_STATE_FILE;
  if (!paidMode) {
    console.log(JSON.stringify({
      mode: 'estimate-only', manifestId: manifest.id, manifestSha,
      nextTopics: topics.map((topic) => ({ domain: topic.domain, breadth: topic.breadth })),
      sourceMode: savedSourcePath ? 'saved checkpoint' : 'new retrieval',
      estimatedBy: 'npx tsx scripts/cassian-estimate.ts',
      paidCommand: 'Set CASSIAN_MANIFEST_FILE to the private frozen manifest, then run: npx tsx scripts/cassian-compare.ts --run --topics 3',
      paidCalls: 0,
    }, null, 2));
    return;
  }
  loadEnv();
  llmApi = await import('../src/lib/llm');
  generationApi = await import('../src/server/daily/generate-questions');
  const referenceApi = await import('../src/server/daily/domain-reference');
  const { getReferenceRoutingHints } = await import('../src/server/db/queries/domain-depth-estimate');
  const {
    buildUserPrompt, FACTUAL_GATE_SYSTEM_PROMPT, findAnswerLeaks,
    findAnswerShapeFailures, findUnderDifficultyQuestions,
    parseQuestions, QUALITY_GATE_SYSTEM_PROMPT, SYSTEM_PROMPT,
  } = generationApi;
  const {
    buildRetrievalUserMessage, parseReferenceResponse, questionLeaksPassageText,
    REFERENCE_WIKI_DOMAINS, resolveReferenceSourcePreference, retrievalSystemPrompt,
  } = referenceApi;
  const { wrapUserInput } = llmApi;
  const client = llmApi.getAnthropicClient();
  if (!client) throw new Error('Anthropic client is unavailable; no paid dispatch.');
  const savedSources = savedSourcePath
    ? JSON.parse(readFileSync(resolve(savedSourcePath), 'utf8')) as Checkpoint : null;
  const savedPrior = priorStatePath
    ? JSON.parse(readFileSync(resolve(priorStatePath), 'utf8')) as { prior?: Record<string, PriorEntry[]> } : null;
  if (savedSources) {
    for (const topic of topics) {
      if (!savedSources.calls[`source:${topic.domain}`]) {
        throw new Error(`Saved source missing for ${topic.domain}; no paid dispatch.`);
      }
    }
  }
  unlockRunner = await acquireRunnerLock();
  const checkpoint = load();
  const baseline = manifest.arms.find((arm) => arm.id === 'baseline');
  const candidate = manifest.arms.find((arm) => arm.id === 'candidate');
  if (!baseline || !candidate) throw new Error('Two model arms are required.');
  const status = await getBudgetStatus(manifest.id); // Also verifies migration exists.
  console.log(`Cassian budget before dispatch: spent $${status.lifetimeSpentUsd.toFixed(4)}, reserved $${status.lifetimeReservedUsd.toFixed(4)} of $10.`);
  const hints = await getReferenceRoutingHints(topics.map((topic) => domainKey(topic.domain)));
  for (const topic of topics) {
    const sourceKey = `source:${topic.domain}`;
    const hint = hints.get(domainKey(topic.domain));
    const pref = resolveReferenceSourcePreference(hint);
    const sourceResult = savedSources?.calls[sourceKey] ?? await call(checkpoint, client, sourceKey, 2, {
        model: SOURCE_MODEL, max_tokens: 1500,
      system: retrievalSystemPrompt(pref),
      messages: [{ role: 'user', content: buildRetrievalUserMessage(topic.domain, hint, pref) }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3,
        allowed_domains: REFERENCE_WIKI_DOMAINS }],
    }, 30_000);
    const parsedSource = parseReferenceResponse(sourceResult.raw);
    const reference: DomainReference | null = parsedSource?.found
      ? { source: parsedSource.source, passage: parsedSource.passage } : null;
    for (const arm of [baseline, candidate]) {
      const candidateKey = `${topic.domain}:${arm.id}`;
      // Freeze the same prior-fact context for both arms. Old Cassian cards and
      // the bank/history snapshot from the earlier trial stay out of this run.
      const oldCandidates = savedSources
        ? Object.entries(savedSources.candidates)
          .filter(([key, value]) => key.startsWith(`${topic.domain}:`) && value.question)
          .map(([, value]) => ({ text: value.question!.question_text, factKey: value.question!.fact_key }))
        : [];
      const prior = [...(savedPrior?.prior?.[topic.domain] ?? []), ...oldCandidates];
      const priorTexts = prior.filter((entry) => entry.text).map((entry) => ({ domain: topic.domain, text: entry.text }));
      const priorFacts = prior.filter((entry) => entry.factKey).map((entry) => ({ domain: topic.domain, factKey: entry.factKey! }));
      const userPrompt = buildUserPrompt(
        [topic.domain], 1, priorTexts, priorFacts, undefined, topic.difficulty,
        undefined, undefined, undefined,
        new Map([[topic.domain, 'declared']]), undefined, null, undefined,
        reference ? new Map([[topic.domain, reference]]) : undefined,
      );
      const generation = await call(checkpoint, client, `writer:${candidateKey}`, 0.35, {
        model: arm.model, max_tokens: arm.model === 'claude-haiku-5-5' ? 3000 : 2000,
        temperature: 0.8,
        ...(arm.model === 'claude-haiku-5-5' ? {
          output_config: { effort: 'low' as const }, thinking: { type: 'adaptive' as const },
        } : {}),
        system: [{ type: 'text', text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userPrompt }],
      }, 30_000);
      const parsed = parseQuestions(generation.raw);
      const question = parsed[0] ?? null;
      const checks: Record<string, unknown> = {
        parsedCount: parsed.length, sourceFound: Boolean(reference),
        sourcePreference: pref, sourceUrl: parsedSource?.found ? parsedSource.sourceUrl : null,
      };
      if (question) {
        const deterministic = {
          topic: domainKey(question.canonical_subcategory) === domainKey(topic.domain),
          leak: findAnswerLeaks([question]).toDrop.has(0),
          shape: findAnswerShapeFailures([question]).toDrop.has(0),
          difficulty: findUnderDifficultyQuestions([question], undefined, topic.difficulty).toDrop.has(0),
          sourceCopy: reference ? questionLeaksPassageText(question.question_text, reference.passage) : false,
        };
        checks.deterministic = deterministic;
        const qualityBody = `[0] domain=${question.canonical_subcategory} tier=${question.difficulty_estimate} fact=${question.fact_key ?? '(none)'}\n    q=${question.question_text}\n    a=${question.answer}`;
        const quality = await call(checkpoint, client, `quality:${candidateKey}`, 0.1, {
            model: QUALITY_GATE_MODEL, max_tokens: 500, temperature: 0,
          system: QUALITY_GATE_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: wrapUserInput('batch', qualityBody) }],
        }, 20_000);
        const factualBody = `[0] domain=${question.canonical_subcategory}\n    q=${question.question_text}\n    a=${question.answer}\n    e=${question.explainer}`;
        const factual = await call(checkpoint, client, `factual:${candidateKey}`, 0.3, {
            model: FACTUAL_GATE_MODEL, max_tokens: 2000, temperature: 0,
          system: FACTUAL_GATE_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: wrapUserInput('batch', factualBody) }],
        }, 20_000);
        checks.quality = parseGate(quality.raw);
        checks.factual = parseGate(factual.raw);
        const qualityVerdict = checks.quality as ReturnType<typeof parseGate>;
        const factualVerdict = checks.factual as ReturnType<typeof parseGate>;
        checks.eligible = deterministic.topic && !deterministic.leak && !deterministic.shape
          && !deterministic.difficulty && !deterministic.sourceCopy
          && !qualityVerdict.drop && !factualVerdict.drop;
      }
      checkpoint.candidates[candidateKey] = {
        question, status: !question ? 'parse_failed' : checks.eligible ? 'passed_core_gates' : 'held', checks,
      };
      save(checkpoint);
    }
  }
  const after = await getBudgetStatus(manifest.id);
  console.log(JSON.stringify({
    requestedTopics, candidateCount: Object.keys(checkpoint.candidates).length,
    spentUsd: after.spentUsd, reservedUsd: after.reservedUsd,
    privateCheckpoint: checkpointPath,
  }, null, 2));
}

run().catch((error) => {
  console.error('[cassian] stopped:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(async () => {
  if (unlockRunner) await unlockRunner();
  await closeBudgetPool();
});
