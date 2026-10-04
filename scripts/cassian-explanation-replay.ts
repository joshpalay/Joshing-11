/**
 * Cassian's explanation-free factual-gate replay. Uses saved pilot questions;
 * it never creates questions, changes the bank, or serves a candidate.
 * Default mode is read-only and free. --run makes separately budgeted calls.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import dotenv from 'dotenv';
import { FACTUAL_GATE_MODEL } from './cassian-models';
import { estimateCostUsd } from '../src/server/llm/pricing';

type PilotCandidate = {
  question: { canonical_subcategory: string; question_text: string; answer: string } | null;
  checks: {
    eligible?: boolean; factual?: { drop?: boolean }; quality?: { drop?: boolean };
    deterministic?: { topic?: boolean; leak?: boolean; shape?: boolean; difficulty?: boolean; sourceCopy?: boolean };
  };
};
type PilotCheckpoint = {
  manifestSha: string;
  candidates: Record<string, PilotCandidate>;
};
type ReplayCall = {
  raw: string; model: string; elapsedMs: number; usd: number;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreateTokens: number };
};
type ReplayCheckpoint = { manifestSha: string; calls: Record<string, ReplayCall> };

const args = process.argv.slice(2);
const paid = args.includes('--run');
const manifestPath = resolve(process.env.CASSIAN_MANIFEST_FILE || 'Cassian/manifest.json');
if (paid && !process.env.CASSIAN_MANIFEST_FILE) {
  throw new Error('Paid replay requires CASSIAN_MANIFEST_FILE pointing to the private pilot manifest.');
}
const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString('utf8')) as { id: string };
const manifestSha = createHash('sha256').update(manifestBytes).digest('hex');
const pilotPath = resolve(process.env.CASSIAN_CHECKPOINT_FILE || `_scratch/Cassian/${manifest.id}/checkpoint.json`);
const replayPath = resolve(process.env.CASSIAN_REPLAY_FILE || `_scratch/Cassian/${manifest.id}/no-explanation-replay.json`);
if (!existsSync(pilotPath)) throw new Error('Private pilot checkpoint is missing.');
const pilot = JSON.parse(readFileSync(pilotPath, 'utf8')) as PilotCheckpoint;
if (pilot.manifestSha !== manifestSha) throw new Error('Pilot checkpoint and manifest do not match.');
const candidateEntries = Object.entries(pilot.candidates)
  .filter((entry): entry is [string, PilotCandidate & { question: NonNullable<PilotCandidate['question']> }] =>
    entry[1].question !== null)
  .sort(([a], [b]) => a.localeCompare(b));
const replay: ReplayCheckpoint = existsSync(replayPath)
  ? JSON.parse(readFileSync(replayPath, 'utf8')) as ReplayCheckpoint
  : { manifestSha, calls: {} };
if (replay.manifestSha !== manifestSha) throw new Error('Replay checkpoint and manifest do not match.');

function save(): void {
  mkdirSync(dirname(replayPath), { recursive: true });
  const temporary = `${replayPath}.tmp`;
  writeFileSync(temporary, JSON.stringify(replay, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, replayPath);
}

async function main(): Promise<void> {
  if (!paid) {
    console.log(JSON.stringify({ mode: 'estimate-only', candidates: candidateEntries.length,
      completed: Object.keys(replay.calls).length,
      maximumAdditionalReservationUsd: (candidateEntries.length - Object.keys(replay.calls).length) * 0.03,
      note: 'Gate-only replay. It does not measure no-explanation writer output or replacement calls.' }, null, 2));
    return;
  }
  dotenv.config({ path: process.env.CASSIAN_ENV_FILE || '.env.local', quiet: true });
  const { getAnthropicClient, extractTextContent, parseJsonObject, sanitizeParamsForModel, wrapUserInput } = await import('../src/lib/llm');
  const { FACTUAL_GATE_SYSTEM_PROMPT, parseFactualGateResponse } = await import('../src/server/daily/generate-questions');
  const { acquireRunnerLock, closeBudgetPool, getBudgetStatus, reserveCall, settleCall,
  } = await import('../src/server/cassian/budget');
  const explainerRule = /^  - the EXPLAINER \(e=\).*\r?\n/m;
  if (!explainerRule.test(FACTUAL_GATE_SYSTEM_PROMPT) ||
    !FACTUAL_GATE_SYSTEM_PROMPT.includes('neither the setup nor the explainer contains a false factual claim')) {
    throw new Error('Factual gate prompt changed; update the replay rubric before spending.');
  }
  const system = FACTUAL_GATE_SYSTEM_PROMPT.replace(explainerRule, '')
    .replace('neither the setup nor the explainer contains a false factual claim',
      'the setup contains no false factual claim');
  const client = getAnthropicClient();
  if (!client) throw new Error('Anthropic client is unavailable.');
  let unlock: (() => Promise<void>) | undefined;
  try {
    unlock = await acquireRunnerLock();
    const budget = await getBudgetStatus(manifest.id);
    const pending = candidateEntries.filter(([key]) => !replay.calls[key]).length;
    const worstCase = pending * 0.03;
    if (budget.lifetimeSpentUsd + budget.lifetimeReservedUsd + worstCase > 10 ||
      budget.spentUsd + budget.reservedUsd + worstCase > 4) {
      throw new Error('Worst-case replay reservation exceeds the Cassian budget.');
    }
    console.log(JSON.stringify({ pending, worstCaseReserveUsd: worstCase,
      lifetimeSpentUsd: budget.lifetimeSpentUsd, lifetimeReservedUsd: budget.lifetimeReservedUsd }));
    for (const [candidateKey, snapshot] of candidateEntries) {
      if (replay.calls[candidateKey]) continue;
      // v1 sent an unsupported sampling parameter and was rejected before inference.
      // Keep that settled zero-cost attempt in the ledger; v2 has a distinct key.
      const key = `factual-no-explanation-v2:${candidateKey}`;
      const reservation = await reserveCall({ runId: manifest.id, manifestSha, key, reserveUsd: 0.03 });
      if (reservation === 'already_done') {
        throw new Error('Ledger has a completed replay call missing from the private checkpoint; stop without repeating.');
      }
      const body = `[0] domain=${snapshot.question.canonical_subcategory}\n    q=${snapshot.question.question_text}\n    a=${snapshot.question.answer}`;
      const started = Date.now();
      let result: ReplayCall;
      try {
        const response = await client.messages.create(sanitizeParamsForModel({
          model: FACTUAL_GATE_MODEL, max_tokens: 2000, temperature: 0,
          system, messages: [{ role: 'user', content: wrapUserInput('batch', body) }],
        }), { signal: AbortSignal.timeout(20_000), maxRetries: 0 });
        const usage = {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
          cacheCreateTokens: response.usage.cache_creation_input_tokens ?? 0,
        };
        const cost = estimateCostUsd(response.model, { ...usage, webSearchRequests: 0 });
        if (cost.usd === null) throw new Error('Replay response model has no price.');
        result = { raw: extractTextContent(response.content), model: response.model,
          elapsedMs: Date.now() - started, usd: cost.usd, usage };
        replay.calls[candidateKey] = result;
        save(); // Preserve output before settling so a resume never repeats a paid call.
      } catch (error) {
        await settleCall({ runId: manifest.id, key, actualUsd: null,
          reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown replay failure' });
        throw error;
      }
      await settleCall({ runId: manifest.id, key, actualUsd: result.usd });
      console.log(`Replayed ${Object.keys(replay.calls).length}/${candidateEntries.length}; $${result.usd.toFixed(4)}`);
    }
    let oldEligible = 0;
    let newEligible = 0;
    let newlyEligible = 0;
    let newlyHeld = 0;
    let oldFactualDrops = 0;
    let newFactualDrops = 0;
    let invalidVerdicts = 0;
    for (const [key, snapshot] of candidateEntries) {
      const oldPass = snapshot.checks.eligible === true;
      const oldFactualDrop = snapshot.checks.factual?.drop === true;
      const parsed = parseJsonObject(replay.calls[key].raw);
      const valid = Boolean(parsed && Array.isArray(parsed.drop_indices) &&
        parsed.reasons && typeof parsed.reasons === 'object' && !Array.isArray(parsed.reasons));
      if (!valid) invalidVerdicts++;
      const newFactualDrop = !valid || parseFactualGateResponse(replay.calls[key].raw, 1).toDrop.has(0);
      const d = snapshot.checks.deterministic;
      const otherGatesPass = d?.topic === true && !d.leak && !d.shape &&
        !d.difficulty && !d.sourceCopy && !snapshot.checks.quality?.drop;
      const wouldPass = otherGatesPass && !newFactualDrop;
      if (oldPass) oldEligible++;
      if (wouldPass) newEligible++;
      if (!oldPass && wouldPass) newlyEligible++;
      if (oldPass && !wouldPass) newlyHeld++;
      if (oldFactualDrop) oldFactualDrops++;
      if (newFactualDrop) newFactualDrops++;
    }
    const replayUsd = Object.values(replay.calls).reduce((sum, call) => sum + call.usd, 0);
    console.log(JSON.stringify({ candidates: candidateEntries.length, oldEligible, newEligible,
      newlyEligible, newlyHeld, oldFactualDrops, newFactualDrops, invalidVerdicts,
      replayUsd, note: 'Gate-only counterfactual. Independently verify recovered and newly held items; do not treat this as an actual no-explanation generation run.' }, null, 2));
  } finally {
    if (unlock) await unlock();
    await closeBudgetPool();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
