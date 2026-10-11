/** Opt-in offline replay; never writes candidates, gameplay or production prompts. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { validateManifest, schedule, scoreGate, modelForStep, type GateManifest } from './cassian-gate-core';
import { estimateCostUsd } from '../src/server/llm/pricing';
import { acquireRunnerLock, closeBudgetPool, getBudgetStatus, reserveCall, settleCall } from '../src/server/cassian/budget';

async function main(): Promise<void> {
  const manifestPath = process.env.CASSIAN_MANIFEST_FILE;
  if (!manifestPath) throw new Error('Set CASSIAN_MANIFEST_FILE to the private frozen gate manifest.');
  const bytes = readFileSync(resolve(manifestPath));
  const manifest = JSON.parse(bytes.toString('utf8')) as GateManifest;
  validateManifest(manifest);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const steps = schedule(manifest);
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg < 0 ? steps.length : Number(process.argv[limitArg + 1]);
  if (!Number.isInteger(limit) || limit < 1 || limit > steps.length) throw new Error('Invalid call limit.');
  const paid = process.argv.includes('--run') || process.argv.includes('--resume');
  if (!paid) {
    const estimate = steps.reduce((sum, s) => sum + (estimateCostUsd(modelForStep(manifest, s.case.gate, s.arm), {
      inputTokens: Math.ceil((manifest.prompts[s.case.gate][s.arm].length + s.case.body.length) / 3.5),
      outputTokens: s.case.gate === 'quality' ? 160 : 240,
      cacheReadTokens: 0, cacheCreateTokens: 0,
    }).usd ?? Infinity), 0);
    console.log(JSON.stringify({ runId: manifest.id, cases: manifest.cases.length, calls: steps.length,
      selectedCalls: limit, estimatedUsd: estimate, runCapUsd: manifest.maxRunUsd, paidCalls: 0,
      qualityModels: manifest.qualityModels }));
    return;
  }
  dotenv.config({ path: process.env.CASSIAN_ENV_FILE || '.env.local', quiet: true });
  if (!process.env.DATABASE_URL || !process.env.ANTHROPIC_API_KEY) throw new Error('Missing gate replay credentials.');
  const dir = resolve('_scratch/Cassian', manifest.id);
  const path = resolve(dir, 'checkpoint.json');
  type Call = { raw: string; model: string; requestId: string | null; usd: number; elapsedMs: number; stopReason: string | null; usage: Parameters<typeof estimateCostUsd>[1] };
  const checkpoint: { manifestSha: string; calls: Record<string, Call> } = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8')) : { manifestSha: sha, calls: {} };
  if (checkpoint.manifestSha !== sha) throw new Error('Frozen manifest differs from checkpoint.');
  mkdirSync(dir, { recursive: true });
  const save = () => { writeFileSync(`${path}.tmp`, JSON.stringify(checkpoint, null, 2), { mode: 0o600 }); renameSync(`${path}.tmp`, path); };
  const unlock = await acquireRunnerLock();
  try {
    const before = await getBudgetStatus(manifest.id);
    if (before.lifetimeReservedUsd > 0) throw new Error('Unresolved reservation; stop before dispatch.');
    const llm = await import('../src/lib/llm');
    const client = llm.getAnthropicClient();
    if (!client) throw new Error('Anthropic client unavailable.');
    for (const step of steps.slice(0, limit)) {
      const reservation = await reserveCall({ runId: manifest.id, manifestSha: sha, key: step.key,
        reserveUsd: step.case.gate === 'quality' ? 0.02 : 0.05, runCap: manifest.maxRunUsd });
      if (reservation === 'already_done') {
        if (!checkpoint.calls[step.key]) throw new Error('Completed ledger step lacks checkpoint; do not repeat.');
        continue;
      }
      const start = Date.now();
      let result: Call;
      try {
        const response = await client.messages.create(llm.sanitizeParamsForModel({
          model: modelForStep(manifest, step.case.gate, step.arm), max_tokens: step.case.gate === 'quality' ? 500 : 2000,
          temperature: 0, system: manifest.prompts[step.case.gate][step.arm],
          messages: [{ role: 'user', content: llm.wrapUserInput('batch', step.case.body) }],
        }), { maxRetries: 0, signal: AbortSignal.timeout(30000) });
        const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0, cacheCreateTokens: response.usage.cache_creation_input_tokens ?? 0 };
        const cost = estimateCostUsd(response.model, usage);
        if (cost.usd === null) throw new Error('Unpriced response; retain reservation.');
        result = { raw: llm.extractTextContent(response.content), model: response.model, requestId: response._request_id ?? null,
          usd: cost.usd, elapsedMs: Date.now() - start, stopReason: response.stop_reason, usage };
        checkpoint.calls[step.key] = result; save();
      } catch (e) {
        await settleCall({ runId: manifest.id, key: step.key, actualUsd: null,
          reason: e instanceof Error ? e.message.slice(0, 200) : 'Unknown failure' });
        throw e;
      }
      await settleCall({ runId: manifest.id, key: step.key, actualUsd: result.usd });
      console.log(`${step.key}: $${result.usd.toFixed(5)}`);
    }
    const scores = steps.filter(s => checkpoint.calls[s.key]).map(s => ({ key: s.key, gate: s.case.gate, arm: s.arm,
      kind: s.case.kind, expected: s.case.expectedDecision, ...scoreGate(checkpoint.calls[s.key].raw, s.case, llm.parseJsonObject) }));
    writeFileSync(resolve(dir, 'scores.json'), JSON.stringify({ manifestSha: sha, scores }, null, 2), { mode: 0o600 });
    const status = await getBudgetStatus(manifest.id);
    console.log(JSON.stringify({ completeCalls: scores.length, expectedCalls: steps.length, spentUsd: status.spentUsd,
      reservedUsd: status.reservedUsd, lifetimeSpentUsd: status.lifetimeSpentUsd,
      groups: ['quality', 'factual'].flatMap(g => ['baseline', 'candidate'].map(a => {
        const rows = scores.filter(s => s.gate === g && s.arm === a);
        return { gate: g, arm: a, calls: rows.length, correctDecisions: rows.filter(s => s.decisionCorrect).length,
          valid: rows.filter(s => s.valid).length, reasonCorrect: rows.filter(s => s.reasonCorrect === true).length };
      })) }));
  } finally {
    await unlock(); await closeBudgetPool();
  }
}
main().catch(e => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
