/** Offline only. Default plans; --score-only reads saved replies; paid modes retain the shared budget guard. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { assertReviewBudgetClear, planTargetedReview, scoreTargetedReview, validateTargetedManifest, type ReviewReply } from './cassian-targeted-core';
import { estimateCostUsd } from '../src/server/llm/pricing';
import { acquireRunnerLock, closeBudgetPool, getBudgetStatus, reserveCall, settleCall } from '../src/server/cassian/budget';

async function main() {
  if (!process.env.CASSIAN_MANIFEST_FILE) throw new Error('Set CASSIAN_MANIFEST_FILE to the frozen private targeted-review manifest.');
  const bytes = readFileSync(resolve(process.env.CASSIAN_MANIFEST_FILE));
  const manifest = validateTargetedManifest(JSON.parse(bytes.toString('utf8')));
  const manifestSha = createHash('sha256').update(bytes).digest('hex');
  const steps = planTargetedReview(manifest);
  const paid = process.argv.includes('--run') || process.argv.includes('--resume');
  const scoreOnly = process.argv.includes('--score-only');
  if (scoreOnly && paid) throw new Error('Local scoring cannot be combined with paid flags.');
  const dir = resolve('_scratch/Cassian', manifest.id);
  const path = resolve(dir, 'checkpoint.json');
  const checkpoint: { manifestSha: string; calls: Record<string, ReviewReply> } = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8')) : { manifestSha, calls: {} };
  if (checkpoint.manifestSha !== manifestSha) throw new Error('Frozen manifest differs from checkpoint.');
  if (Object.entries(checkpoint.calls).some(([key, call]) => {
    const step = steps.find(s => s.key === key);
    return !step || call.model !== manifest.models[step.kind] || !Number.isFinite(call.usd) || call.usd < 0 ||
      !Number.isFinite(call.elapsedMs) || call.elapsedMs < 0 || typeof call.raw !== 'string';
  })) throw new Error('Invalid checkpoint call metadata.');
  const limitIndex = process.argv.indexOf('--limit');
  const limit = limitIndex < 0 ? steps.length : Number(process.argv[limitIndex + 1]);
  if (!Number.isInteger(limit) || limit < 0 || limit > steps.length) throw new Error('Invalid call limit.');
  let paidCalls = 0;
  const score = () => {
    const result = scoreTargetedReview(manifest, checkpoint.calls);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'scores.json'), JSON.stringify({ manifestSha, ...result }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ manifestSha, ...result, rows: undefined, paidCalls }));
  };
  if (scoreOnly) { score(); return; }
  if (!paid) {
    const estimatedUsd = steps.reduce((sum, step) => sum + (estimateCostUsd(manifest.models[step.kind], {
      inputTokens: Math.ceil((manifest.prompts[step.kind].length + step.body.length) / 3), outputTokens: 2000,
      cacheReadTokens: 0, cacheCreateTokens: 0,
    }).usd ?? Infinity), 0);
    const original = scoreTargetedReview(manifest, {});
    console.log(JSON.stringify({ runId: manifest.id, manifestSha, items: original.rows.length,
      plannedCalls: steps.length, qualityReviewItems: original.reviewItems,
      factualReviewItems: steps.filter(s => s.kind === 'factual').reduce((sum, s) => sum + s.ids.length, 0),
      estimatedUsd, runCapUsd: manifest.maxRunUsd, paidCalls: 0,
      existingBaseline: original.groups.filter(g => g.pipeline === 'baseline') }));
    return;
  }
  dotenv.config({ path: process.env.CASSIAN_ENV_FILE || '.env.local', quiet: true });
  if (!process.env.DATABASE_URL || !process.env.ANTHROPIC_API_KEY) throw new Error('Missing review credentials.');
  const unlock = await acquireRunnerLock();
  try {
    const before = await getBudgetStatus(manifest.id);
    assertReviewBudgetClear(before.lifetimeReservedUsd);
    const llm = await import('../src/lib/llm');
    const client = llm.getAnthropicClient();
    if (!client) throw new Error('Anthropic client unavailable.');
    const save = () => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${path}.tmp`, JSON.stringify(checkpoint, null, 2), { mode: 0o600 }); renameSync(`${path}.tmp`, path);
    };
    for (const step of steps.slice(0, limit)) {
      const reservation = await reserveCall({ runId: manifest.id, manifestSha, key: step.key,
        reserveUsd: 0.15, runCap: manifest.maxRunUsd });
      if (reservation === 'already_done') {
        if (!checkpoint.calls[step.key]) throw new Error('Completed ledger call lacks checkpoint; do not repeat.');
        continue;
      }
      const startedAt = Date.now();
      let usd: number;
      try {
        paidCalls++;
        const response = await client.messages.create(llm.sanitizeParamsForModel({
          model: manifest.models[step.kind], max_tokens: manifest.requestSettings.maxTokens, temperature: 0,
          system: manifest.prompts[step.kind], messages: [{ role: 'user', content: llm.wrapUserInput('items', step.body) }],
        }), { maxRetries: manifest.requestSettings.maxRetries, signal: AbortSignal.timeout(manifest.requestSettings.timeoutMs) });
        const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0, cacheCreateTokens: response.usage.cache_creation_input_tokens ?? 0 };
        const cost = estimateCostUsd(response.model, usage);
        if (cost.usd === null) throw new Error('Unpriced response; retain reservation.');
        usd = cost.usd;
        checkpoint.calls[step.key] = { raw: llm.extractTextContent(response.content), model: response.model,
          requestId: response._request_id ?? null, stopReason: response.stop_reason, usd,
          elapsedMs: Date.now() - startedAt, usage };
        save();
      } catch (error) {
        const reason = error instanceof Error ? error.message.slice(0, 200) : 'Unknown review failure';
        const requestId = error && typeof error === 'object' && 'request_id' in error && typeof error.request_id === 'string'
          ? error.request_id : null;
        try {
          mkdirSync(dir, { recursive: true });
          writeFileSync(resolve(dir, 'failure.json'), JSON.stringify({ manifestSha, key: step.key,
            model: manifest.models[step.kind], startedAt: new Date(startedAt).toISOString(),
            failedAt: new Date().toISOString(), requestId, reason, charge: 'unknown', retried: false }, null, 2), { mode: 0o600 });
        } finally {
          await settleCall({ runId: manifest.id, key: step.key, actualUsd: null, reason });
        }
        throw error;
      }
      await settleCall({ runId: manifest.id, key: step.key, actualUsd: usd });
      const after = await getBudgetStatus(manifest.id);
      if (after.lifetimeReservedUsd > 0 || usd > 0.15) throw new Error('Review accounting halted further dispatch.');
    }
    score();
  } finally {
    await unlock(); await closeBudgetPool();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
