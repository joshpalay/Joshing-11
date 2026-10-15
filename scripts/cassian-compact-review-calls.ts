/** Opt-in source-review format comparison. Frozen receipts and ledger rules prevent replay after uncertain calls. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { validateDesign, buildJobs, params, hash, receiptAction, validateReceipt, scoreCase, summarize, labelSchema, MODEL, TIMEOUT_MS,
  type ReviewJob, type Progress, type Receipt } from './cassian-compact-review-core';
import { assertReviewBudgetClear } from './cassian-targeted-core';
import { estimateCostUsd } from '../src/server/llm/pricing';
import { acquireRunnerLock, getBudgetStatus, getUnrelatedUncertainReserveUsd, reserveCall, settleCall, closeBudgetPool } from '../src/server/cassian/budget';

async function main() {
  const file = process.env.CASSIAN_COMPACT_DESIGN; if (!file) throw Error('Set CASSIAN_COMPACT_DESIGN to the frozen private design.');
  const bytes = readFileSync(resolve(file)), designSha = hash(bytes), d = validateDesign(JSON.parse(bytes.toString('utf8')));
  for (const pin of d.files) if (hash(readFileSync(resolve(pin.path))) !== pin.sha) throw Error(`Frozen runtime/input changed: ${pin.path}`);
  const dir = resolve('_scratch/Cassian', d.id), checkpoint = resolve(dir, 'checkpoint.json'), receipts = resolve(dir, 'receipts'), requests = resolve(dir, 'requests');
  const saved = existsSync(checkpoint) ? JSON.parse(readFileSync(checkpoint, 'utf8')) : { designSha, progress: { calls: {}, blocked: {} } };
  if (saved.designSha !== designSha) throw Error('Checkpoint design changed; never repeat calls');
  const p = saved.progress as Progress, jobs = buildJobs(d);
  if (existsSync(receipts)) for (const name of readdirSync(receipts)) {
    if (!name.endsWith('.json')) continue; const r = JSON.parse(readFileSync(resolve(receipts, name), 'utf8')) as Receipt;
    if (p.calls[r.key] && JSON.stringify(p.calls[r.key]) !== JSON.stringify(r)) throw Error('Journal/checkpoint conflict'); p.calls[r.key] = r;
  }
  for (const [key, r] of Object.entries(p.calls)) { const j = jobs.find(j => j.key === key); if (!j) throw Error('Unknown receipt'); validateReceipt(r, j, designSha); }
  const flags = process.argv.slice(2), run = flags.includes('--run'), budget = flags.includes('--budget'), preflight = flags.includes('--preflight');
  if (flags.some(f => !['--run', '--budget', '--preflight', '--score'].includes(f))) throw Error('Unknown flag');
  const maxUsd = jobs.reduce((s, j) => s + j.reserveUsd, 0);
  const summary = () => ({ runId: d.id, stage: d.stage, designSha, jobs: jobs.length, worstCaseUsd: maxUsd, completed: Object.keys(p.calls).length,
    blocked: Object.keys(p.blocked).length, responseUsd: Object.values(p.calls).reduce((s, r) => s + r.usd, 0) });
  if (flags.includes('--score')) {
    const labelsFile = process.env.CASSIAN_COMPACT_LABELS; if (!labelsFile) throw Error('Set CASSIAN_COMPACT_LABELS');
    const lb = readFileSync(resolve(labelsFile)); if (hash(lb) !== d.labelsSha) throw Error('Labels changed after freeze');
    const labels = labelSchema.array().parse(JSON.parse(lb.toString('utf8')));
    const rows = jobs.map(j => { const c = d.cases.find(c => c.caseId === j.caseId)!, l = labels.find(l => l.caseId === j.caseId); if (!l) throw Error('Missing label');
      return scoreCase(j.arm, c, l, p.calls[j.key]); });
    console.log(JSON.stringify({ ...summary(), arms: d.arms.map(a => summarize(rows, a)), rows }, null, 2)); return;
  }
  dotenv.config({ path: process.env.CASSIAN_ENV_FILE || '.env.local', quiet: true });
  if (budget) {
    try { const s = await getBudgetStatus(d.id), carried = await getUnrelatedUncertainReserveUsd(d.id);
      console.log(JSON.stringify({ ...summary(), budget: s, carriedUncertaintyUsd: carried, availableUsd: 10 - s.lifetimeSpentUsd - s.lifetimeReservedUsd }));
    } finally { await closeBudgetPool(); } return;
  }
  if (!run && !preflight) { console.log(JSON.stringify(summary())); return; }
  if (!process.env.ANTHROPIC_API_KEY || (run && !process.env.DATABASE_URL)) throw Error('Missing credentials');
  const saveJson = (path: string, value: unknown) => { mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); renameSync(path + '.tmp', path); };
  const save = () => saveJson(checkpoint, saved);
  const llm = await import('../src/lib/llm'), client = llm.getAnthropicClient(); if (!client) throw Error('Anthropic client unavailable');
  const count = async (j: ReviewJob) => { const q = params(j);
    const r = await client.messages.countTokens({ model: q.model, system: q.system, messages: q.messages, thinking: q.thinking, output_config: q.output_config }, { maxRetries: 0, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return r.input_tokens; };
  if (preflight) { const out = []; for (const j of jobs) out.push({ key: j.key, inputTokens: await count(j), maxInputTokens: j.maxInputTokens }); console.log(JSON.stringify(out)); return; }
  const unlock = await acquireRunnerLock(); let paid = 0;
  try {
    const status = await getBudgetStatus(d.id);
    for (const [key, ledger] of Object.entries(status.calls)) { const action = receiptAction(ledger, p.calls[key] as never);
      if (action === 'block') throw Error(`Unresolved/missing receipt for ${key}; never repeat`); if (action === 'settle') await settleCall({ runId: d.id, key, actualUsd: p.calls[key].usd }); }
    const before = await getBudgetStatus(d.id);
    assertReviewBudgetClear(before.lifetimeReservedUsd, await getUnrelatedUncertainReserveUsd(d.id), before.reservedUsd);
    const remaining = jobs.filter(j => !p.calls[j.key] && !p.blocked[j.key]).reduce((s, j) => s + j.reserveUsd, 0);
    if (before.spentUsd + remaining > d.maxRunUsd + 1e-9 || 10 - before.lifetimeSpentUsd - before.lifetimeReservedUsd < remaining - 1e-9) throw Error('Remaining worst case does not fit budget');
    console.log(JSON.stringify({ before: { lifetimeSpentUsd: before.lifetimeSpentUsd, lifetimeReservedUsd: before.lifetimeReservedUsd, runSpentUsd: before.spentUsd }, remainingWorstCaseUsd: remaining }));
    for (const j of jobs) {
      if (p.calls[j.key] || p.blocked[j.key]) continue;
      const path = resolve(requests, j.key + '.json'); if (!existsSync(path)) saveJson(path, { job: j, params: params(j) });
      const counted = await count(j);
      if (counted > j.maxInputTokens) { p.blocked[j.key] = { requestSha: j.sha, reason: `input ${counted} exceeds frozen ${j.maxInputTokens}; no paid call` }; save(); continue; }
      const s = await getBudgetStatus(d.id); assertReviewBudgetClear(s.lifetimeReservedUsd, await getUnrelatedUncertainReserveUsd(d.id), s.reservedUsd);
      if (await reserveCall({ runId: d.id, manifestSha: designSha, key: j.key, reserveUsd: j.reserveUsd, runCap: d.maxRunUsd }) === 'already_done') throw Error('Settled call without receipt; never repeat');
      const started = Date.now(); let knownUsd: number | null = null, receipt: Receipt;
      try {
        paid++; const response = await client.messages.create(params(j), { maxRetries: 0, signal: AbortSignal.timeout(TIMEOUT_MS) });
        const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, cacheReadTokens: response.usage.cache_read_input_tokens ?? 0, cacheCreateTokens: response.usage.cache_creation_input_tokens ?? 0 };
        knownUsd = estimateCostUsd(response.model, usage).usd; if (knownUsd === null) throw Error('Unpriced response');
        const raw = llm.extractTextContent(response.content);
        const blocks = response.content.map(b => ({ type: b.type, chars: b.type === 'text' ? b.text.length : b.type === 'thinking' ? b.thinking.length : b.type === 'redacted_thinking' ? b.data.length : 0 }));
        receipt = validateReceipt({ designSha, key: j.key, requestSha: j.sha, raw, rawSha: hash(raw), model: response.model, requestId: response._request_id ?? null,
          stopReason: response.stop_reason, usd: knownUsd, elapsedMs: Date.now() - started, usage, blocks, providerUsage: JSON.parse(JSON.stringify(response.usage)) }, j, designSha);
        saveJson(resolve(receipts, j.key + '.json'), receipt); p.calls[j.key] = receipt; save();
      } catch (error) {
        const reason = error instanceof Error ? error.message.slice(0, 200) : 'Paid-call failure';
        try { saveJson(resolve(dir, 'failure-' + j.key + '.json'), { designSha, key: j.key, requestSha: j.sha, at: new Date().toISOString(), reserveUsd: j.reserveUsd, actualUsd: knownUsd, charge: knownUsd === null ? 'unknown' : 'known', retried: false, reason }); }
        finally { await settleCall({ runId: d.id, key: j.key, actualUsd: knownUsd, reason }); }
        throw error;
      }
      await settleCall({ runId: d.id, key: j.key, actualUsd: receipt.usd });
      console.log(JSON.stringify({ key: j.key, usd: receipt.usd, in: receipt.usage.inputTokens, out: receipt.usage.outputTokens, ms: receipt.elapsedMs, stop: receipt.stopReason, blocks: receipt.blocks.map(b => b.type).join(',') }));
      if (receipt.usd > j.reserveUsd + 1e-9) throw Error('Provider usage exceeded frozen envelope; actual charge recorded');
    }
    save(); console.log(JSON.stringify({ ...summary(), paidCalls: paid, model: MODEL }));
  } finally { await unlock(); await closeBudgetPool(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
