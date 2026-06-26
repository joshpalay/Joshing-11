// Variance-vs-bias audit for the question-quality gate (B-LLM-PROVIDER-AB-METRICS
// follow-up). Answers one question: when the cheap Haiku gate misses a bad
// question, is that because Haiku's misses are RANDOM (variance — so running it a
// few times and taking the union would recover them, cheaply) or SYSTEMATIC
// (bias — Haiku lacks the knowledge, so repeating it can't help and you need a
// stronger model / retrieval)?
//
// It samples recent machine-generated questions and runs each through the same
// false-premise / internal-consistency gate at three configs:
//   • Haiku  ×K   (default 5, temperature 1 + a per-run nonce, to decorrelate)
//   • Sonnet ×1
//   • gpt-4.1 ×1  (only if OPENAI_API_KEY is present)
// then diffs what each catches and prices it from src/server/llm/pricing.ts.
//
// READ-ONLY: the only DB access is a SELECT over GeneratedQuestion. No writes.
//
// DRY-RUN BY DEFAULT (mirrors backfill-pool-embeddings): without --run it prints
// the plan + a rough cost ceiling and makes ZERO LLM calls. Add --run to execute.
//
// Usage (secrets live in .env.local):
//   npx tsx -r dotenv/config scripts/audit-gate-variance.ts dotenv_config_path=.env.local
//   npx tsx -r dotenv/config scripts/audit-gate-variance.ts --run --limit 40 --haiku-runs 5 dotenv_config_path=.env.local
//   ...add --out report.json to also write the per-question detail.
import 'dotenv/config';

import { desc } from 'drizzle-orm';
import { writeFileSync } from 'node:fs';

import { db, pool, generatedQuestions } from '../src/server/db';
import {
  ANTHROPIC_MODEL,
  HAIKU_MODEL,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
  parseJsonObject,
} from '../src/lib/llm';
import {
  OPENAI_FLAGSHIP_MODEL,
  getOpenAIClient,
  openaiCompleteJsonText,
} from '../src/server/llm/provider';
import { estimateCostUsd } from '../src/server/llm/pricing';

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string, d: number) => {
  const i = argv.indexOf(f);
  if (i === -1 || i + 1 >= argv.length) return d;
  const n = Number(argv[i + 1]);
  return Number.isFinite(n) ? n : d;
};
const RUN = has('--run');
const LIMIT = val('--limit', 40);
const HAIKU_RUNS = Math.max(1, val('--haiku-runs', 5));
const USE_OPENAI = !has('--no-openai');
const OUT = (() => {
  const i = argv.indexOf('--out');
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : null;
})();
const PER_CALL_TIMEOUT_MS = 20_000;

// ── the gate ─────────────────────────────────────────────────────────────────
// Deliberately recall-oriented and aimed at the defect class Haiku has been
// missing (false premise / internal inconsistency), not a full quality rubric.
const SYSTEM = `You are a strict fact-checker for a trivia question pool. Decide whether a generated question is sound enough to show players.

FLAG the question if ANY of these hold:
1. false premise — the question's setup asserts something false, or a causal/factual claim that does not actually hold, even if the intended answer is "right".
2. wrong answer — the stated answer is incorrect, or is not clearly the single best answer.
3. internal inconsistency — the question contradicts itself or its own premise.
4. answer leakage — the answer is given away in the question text.
5. hopeless ambiguity — multiple equally-valid answers with no way to choose.

Otherwise PASS. Be willing to fail a question whose answer is technically correct but whose framing embeds a false premise.

Return JSON only: {"verdict":"pass"|"flag","issue":"<short reason, or empty if pass>"}`;

function buildUserText(q: { questionText: string; answer: string; explainer: string }, nonce: number): string {
  return [
    `Question: ${q.questionText}`,
    `Stated answer: ${q.answer}`,
    q.explainer ? `Explainer: ${q.explainer}` : '',
    `(review id ${nonce})`,
  ]
    .filter(Boolean)
    .join('\n');
}

type GateOutcome = {
  flagged: boolean | null; // null = call/parse error (excluded from rates)
  issue: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
};

function interpret(text: string | null): { flagged: boolean | null; issue: string } {
  if (text == null) return { flagged: null, issue: '' };
  const parsed = parseJsonObject(text) as { verdict?: unknown; issue?: unknown } | null;
  const v = typeof parsed?.verdict === 'string' ? parsed.verdict.toLowerCase() : '';
  if (v !== 'flag' && v !== 'pass') return { flagged: null, issue: '' };
  return { flagged: v === 'flag', issue: typeof parsed?.issue === 'string' ? parsed.issue : '' };
}

async function runAnthropic(model: string, userText: string, temperature?: number): Promise<GateOutcome> {
  const client = getAnthropicClient();
  if (!client) return { flagged: null, issue: '', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 };
  try {
    const res = await loggedMessagesCreate(
      client,
      'audit:gate',
      {
        model,
        max_tokens: 300,
        ...(temperature != null ? { temperature } : {}),
        system: SYSTEM,
        messages: [{ role: 'user', content: userText }],
      },
      { timeoutMs: PER_CALL_TIMEOUT_MS },
    );
    const { flagged, issue } = interpret(extractTextContent(res.content));
    const u = res.usage;
    return {
      flagged,
      issue,
      inputTokens: u?.input_tokens ?? 0,
      outputTokens: u?.output_tokens ?? 0,
      cacheReadTokens: u?.cache_read_input_tokens ?? 0,
      cacheCreateTokens: u?.cache_creation_input_tokens ?? 0,
    };
  } catch {
    return { flagged: null, issue: '', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 };
  }
}

async function runOpenAI(userText: string): Promise<GateOutcome> {
  try {
    const text = await openaiCompleteJsonText({
      scope: 'audit:gate',
      systemText: SYSTEM,
      userText,
      model: OPENAI_FLAGSHIP_MODEL,
      maxTokens: 300,
      temperature: 0.7,
      timeoutMs: PER_CALL_TIMEOUT_MS,
    });
    const { flagged, issue } = interpret(text);
    // openaiCompleteJsonText doesn't return usage; estimate tokens (~4 chars/token).
    return {
      flagged,
      issue,
      inputTokens: Math.ceil((SYSTEM.length + userText.length) / 4),
      outputTokens: Math.ceil((text?.length ?? 0) / 4),
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    };
  } catch {
    return { flagged: null, issue: '', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 };
  }
}

// ── cost accumulator ─────────────────────────────────────────────────────────
type Acc = { calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreateTokens: number };
const emptyAcc = (): Acc => ({ calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 });
function add(acc: Acc, o: GateOutcome) {
  acc.calls += 1;
  acc.inputTokens += o.inputTokens;
  acc.outputTokens += o.outputTokens;
  acc.cacheReadTokens += o.cacheReadTokens;
  acc.cacheCreateTokens += o.cacheCreateTokens;
}
function costOf(model: string, acc: Acc): number {
  return estimateCostUsd(model, acc).usd ?? 0;
}
const pct = (n: number, d: number) => (d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}%`);
const usd = (x: number) => `$${x.toFixed(4)}`;

async function main() {
  const rows = await db
    .select({
      id: generatedQuestions.id,
      questionText: generatedQuestions.questionText,
      answer: generatedQuestions.answer,
      explainer: generatedQuestions.explainer,
      generatedByProvider: generatedQuestions.generatedByProvider,
    })
    .from(generatedQuestions)
    .orderBy(desc(generatedQuestions.createdAt))
    .limit(LIMIT);

  const openaiAvailable = USE_OPENAI && getOpenAIClient() != null;
  const callsPerQuestion = HAIKU_RUNS + 1 + (openaiAvailable ? 1 : 0);
  const totalCalls = rows.length * callsPerQuestion;

  console.info('=== Gate variance-vs-bias audit ===');
  console.info({
    mode: RUN ? 'RUN' : 'DRY-RUN (no LLM calls; pass --run to execute)',
    sampleSize: rows.length,
    haikuRuns: HAIKU_RUNS,
    openai: openaiAvailable ? OPENAI_FLAGSHIP_MODEL : 'disabled (no key or --no-openai)',
    callsPerQuestion,
    totalLlmCalls: totalCalls,
  });

  if (!RUN) {
    // Rough ceiling at a nominal 300 input / 70 output tokens per call.
    const nominal = { calls: totalCalls, inputTokens: 300 * totalCalls, outputTokens: 70 * totalCalls, cacheReadTokens: 0, cacheCreateTokens: 0 };
    console.info(
      `Rough cost ceiling (nominal 300in/70out per call): Haiku-tier ${usd(costOf(HAIKU_MODEL, nominal))}, Sonnet-tier ${usd(costOf(ANTHROPIC_MODEL, nominal))} — actuals depend on real token counts. Add --run to execute.`,
    );
    await pool.end();
    return;
  }

  const haikuAcc = emptyAcc();
  const sonnetAcc = emptyAcc();
  const openaiAcc = emptyAcc();

  let haiku1Flag = 0; // single-pass (run 0) flag count, denom = haiku1Scored
  let haiku1Scored = 0;
  const haikuUnion = new Set<string>();
  const sonnetFlag = new Set<string>();
  const openaiFlag = new Set<string>();
  let sonnetScored = 0;

  type Detail = {
    id: string;
    question: string;
    answer: string;
    haikuFlags: number;
    haikuRunsScored: number;
    sonnet: boolean | null;
    sonnetIssue: string;
    openai: boolean | null;
  };
  const details: Detail[] = [];

  for (const [idx, q] of rows.entries()) {
    // Haiku ensemble (independent-ish via temperature + nonce).
    let flags = 0;
    let scored = 0;
    for (let r = 0; r < HAIKU_RUNS; r++) {
      const o = await runAnthropic(HAIKU_MODEL, buildUserText(q, idx * 100 + r), 1);
      add(haikuAcc, o);
      if (o.flagged != null) {
        scored++;
        if (o.flagged) flags++;
        if (r === 0) {
          haiku1Scored++;
          if (o.flagged) haiku1Flag++;
        }
      }
    }
    if (flags > 0) haikuUnion.add(q.id);

    // Sonnet single pass.
    const s = await runAnthropic(ANTHROPIC_MODEL, buildUserText(q, idx * 100 + 90));
    add(sonnetAcc, s);
    if (s.flagged != null) {
      sonnetScored++;
      if (s.flagged) sonnetFlag.add(q.id);
    }

    // gpt-4.1 single pass (optional).
    let openai: boolean | null = null;
    if (openaiAvailable) {
      const o = await runOpenAI(buildUserText(q, idx * 100 + 91));
      add(openaiAcc, o);
      openai = o.flagged;
      if (o.flagged) openaiFlag.add(q.id);
    }

    details.push({
      id: q.id,
      question: q.questionText,
      answer: q.answer,
      haikuFlags: flags,
      haikuRunsScored: scored,
      sonnet: s.flagged,
      sonnetIssue: s.issue,
      openai,
    });
    if ((idx + 1) % 10 === 0) console.info(`  …${idx + 1}/${rows.length} questions processed`);
  }

  // ── results ──
  const n = rows.length;
  const haiku1Cost = haikuAcc.calls > 0 ? costOf(HAIKU_MODEL, haikuAcc) / haikuAcc.calls : 0;
  const sonnet1Cost = sonnetAcc.calls > 0 ? costOf(ANTHROPIC_MODEL, sonnetAcc) / sonnetAcc.calls : 0;

  console.info('\n=== Flag rates ===');
  console.info(`Haiku ×1 (first pass): ${pct(haiku1Flag, haiku1Scored)}  (${haiku1Flag}/${haiku1Scored})`);
  console.info(`Haiku ×${HAIKU_RUNS} union:    ${pct(haikuUnion.size, n)}  (${haikuUnion.size}/${n})`);
  console.info(`Sonnet ×1:            ${pct(sonnetFlag.size, sonnetScored)}  (${sonnetFlag.size}/${sonnetScored})`);
  if (openaiAvailable) console.info(`gpt-4.1 ×1:           ${pct(openaiFlag.size, n)}  (${openaiFlag.size}/${n})`);

  console.info('\n=== Cost (measured this run) ===');
  console.info(`Haiku  ${haikuAcc.calls} calls → ${usd(costOf(HAIKU_MODEL, haikuAcc))}  (${usd(haiku1Cost)}/call)`);
  console.info(`Sonnet ${sonnetAcc.calls} calls → ${usd(costOf(ANTHROPIC_MODEL, sonnetAcc))}  (${usd(sonnet1Cost)}/call)`);
  if (openaiAvailable) console.info(`gpt-4.1 ${openaiAcc.calls} calls → ${usd(costOf(OPENAI_FLAGSHIP_MODEL, openaiAcc))} (approx; token est.)`);

  // ── the verdict: does the Haiku ensemble recover Sonnet's catches? ──
  const sonnetOnly = [...sonnetFlag].filter((id) => !haikuUnion.has(id));
  const recovered = [...sonnetFlag].filter((id) => haikuUnion.has(id)).length;
  const recallOfSonnet = sonnetFlag.size > 0 ? recovered / sonnetFlag.size : null;

  console.info('\n=== Variance vs bias ===');
  if (recallOfSonnet == null) {
    console.info('Sonnet flagged nothing in this sample — inconclusive. Increase --limit or sample a window with known-bad questions.');
  } else {
    console.info(`Haiku ×${HAIKU_RUNS} union recovers ${pct(recovered, sonnetFlag.size)} of Sonnet's flags (${recovered}/${sonnetFlag.size}).`);
    const verdict =
      recallOfSonnet >= 0.8
        ? 'VARIANCE — the Haiku ensemble catches most of what Sonnet does. Ensembling Haiku is the cost-effective fix.'
        : recallOfSonnet < 0.5
          ? 'BIAS — Sonnet catches a class repeated Haiku misses. Ensembling will not help; use a cascade (Haiku triage → escalate to Sonnet) or retrieval-grounding.'
          : 'MIXED — some recoverable by ensemble, some not. A cascade likely wins.';
    console.info(`Verdict: ${verdict}`);
  }

  // Cascade projection: 1 Haiku pass on all + escalate the single-pass flag rate to Sonnet.
  const escalationRate = haiku1Scored > 0 ? haiku1Flag / haiku1Scored : 0;
  const cascadePerQ = haiku1Cost + escalationRate * sonnet1Cost;
  console.info('\n=== Cost knobs (per question) ===');
  console.info(`All-Haiku ×1:   ${usd(haiku1Cost)}`);
  console.info(`All-Haiku ×${HAIKU_RUNS}:   ${usd(haiku1Cost * HAIKU_RUNS)}`);
  console.info(`All-Sonnet ×1:  ${usd(sonnet1Cost)}`);
  console.info(
    `Cascade (Haiku triage → escalate ${pct(haiku1Flag, haiku1Scored)} to Sonnet): ${usd(cascadePerQ)}` +
      (sonnet1Cost > 0 ? `  (${(100 * (1 - cascadePerQ / sonnet1Cost)).toFixed(0)}% cheaper than all-Sonnet)` : ''),
  );

  // The decisive cases: strong model caught it, the Haiku ensemble didn't.
  if (sonnetOnly.length > 0) {
    console.info(`\n=== Sonnet caught, Haiku ×${HAIKU_RUNS} missed (${sonnetOnly.length}) — eyeball these ===`);
    for (const id of sonnetOnly.slice(0, 12)) {
      const d = details.find((x) => x.id === id)!;
      console.info(`• ${d.question}`);
      console.info(`    answer: ${d.answer}`);
      console.info(`    sonnet: ${d.sonnetIssue || '(flagged, no reason given)'}${d.openai === true ? ' | gpt-4.1 also flagged' : openaiAvailable ? ' | gpt-4.1 passed' : ''}`);
    }
    if (sonnetOnly.length > 12) console.info(`  …and ${sonnetOnly.length - 12} more (see --out report).`);
  }

  if (OUT) {
    writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), config: { LIMIT, HAIKU_RUNS, openaiAvailable }, details }, null, 2));
    console.info(`\nWrote per-question detail → ${OUT}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('[audit-gate-variance] failed:', err);
  process.exitCode = 1;
});
