// Ask-to-answer gate (PRD-D-5 §5.3 layer 2 / §7 / B4 Phase 1).
//
// The secondary verification net. For a generated question we STRIP the stored
// answer and ask a separate, cheaper model (Haiku — different from the Sonnet
// generator, per spec "ideally a different model") the question COLD, several
// times. A question passes only when the cold attempts agree with each other AND
// with the stored answer; otherwise it is dropped. This catches the generator
// misreading its own source. Its blind spot — a *stable* hallucination the cold
// model shares — is by design covered by B3 retrieval corroboration, NOT here
// (Drift Risk 3): never lean on ask-to-answer to wave through a retrieval gap.
//
// Fail direction: this gate DROPS questions, never serves them. On an LLM outage
// (no client, timeout, parse failure) it FAILS OPEN — drops nothing, verifies
// nothing — exactly like the other generation gates in generate-questions.ts. A
// question it can't evaluate simply stays `unverified` (it is not falsely
// promoted, and it is not falsely dropped).

import {
  HAIKU_GATE_TIMEOUT_MS,
  HAIKU_MODEL,
  INSTRUCTION_USER_INPUT_GUIDANCE,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
  parseJsonObject,
  wrapUserInput,
} from '@/lib/llm';

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

export interface AskToAnswerConfig {
  /** Master switch. On by default — this is a live generation gate (B4 Phase 1),
   *  but it fails open and is a no-op without an Anthropic client. */
  enabled: boolean;
  /** Cold samples per question (§7 recommends 3, unanimous + match stored). */
  samples: number;
  /** Temperature for the cold attempts. Non-zero so genuine instability in the
   *  answer surfaces across samples; the equivalence judge runs at temp 0. */
  coldTemperature: number;
}

export function getAskToAnswerConfig(): AskToAnswerConfig {
  return {
    enabled: boolEnv('ASK_TO_ANSWER_ENABLED', true),
    samples: Math.max(1, Math.round(numEnv('ASK_TO_ANSWER_SAMPLES', 3))),
    coldTemperature: numEnv('ASK_TO_ANSWER_COLD_TEMPERATURE', 0.7),
  };
}

export interface AskToAnswerItem {
  questionText: string;
  answer: string;
}

export interface AskToAnswerResult {
  /** Indices to drop: the cold attempts clearly did NOT support the stored
   *  answer (disagreed with each other or converged on something else). */
  toDrop: Set<number>;
  /** Indices that affirmatively passed — cold attempts agreed with each other
   *  and matched the stored answer. These earn `machine_verified`. */
  verified: Set<number>;
  /** Distinct cold answers per verified index, normalized and minus the stored
   *  answer — acceptable_variant seeds (B4 Phase 4). The judge already deemed
   *  these equivalent to the stored answer, so they are safe to honor in grading.
   *  Only populated for verified indices. */
  variantsByIndex: Map<number, string[]>;
  reasons: Record<number, string>;
}

const COLD_ANSWER_SYSTEM_PROMPT = `You are answering a single trivia question COLD, with no answer key. Reply with ONLY your best short answer — the name, term, phrase, date, or number the question asks for. No explanation, no preamble, no punctuation beyond what the answer itself needs. If you genuinely do not know, reply with exactly: UNSURE.${INSTRUCTION_USER_INPUT_GUIDANCE}`;

// The equivalence judge compares, per question, the stored answer against the
// cold attempts. It decides PASS / DROP for each. Conservative by construction:
// PASS demands affirmative agreement, DROP demands a clear contradiction, and
// it leaves genuinely-ambiguous items in neither set (they stay `unverified`).
const JUDGE_SYSTEM_PROMPT = `You are auditing trivia questions. For each item you are given the stored answer the game treats as correct, plus several COLD answers an independent solver produced for the same question without seeing the stored answer.

For each item decide one of:
- PASS — the cold answers agree with EACH OTHER and all match the stored answer (allowing equivalent forms: "J.S. Bach" = "Johann Sebastian Bach"; "1969" = "the year 1969"; abbreviations, word order, articles). This means the stored answer is corroborated by an independent solver.
- DROP — the cold answers clearly do NOT support the stored answer: they agree with each other on a DIFFERENT answer, or they are mutually inconsistent (no stable answer exists), indicating the stored answer is likely wrong or the question is unanswerable. Treat UNSURE attempts as "no support".
- SKIP — you cannot tell (e.g. all attempts UNSURE on a genuinely obscure-but-plausible fact). Do not pass and do not drop.

Be strict about PASS and conservative about DROP: only DROP when the cold answers actively contradict the stored answer. When in doubt between SKIP and DROP, choose SKIP.

Return JSON only:
{ "pass_indices": [..], "drop_indices": [..], "reasons": { "<index>": "<short reason naming the answer the cold solver gave>" } }${INSTRUCTION_USER_INPUT_GUIDANCE}`;

/** One cold attempt at a question. Returns the trimmed answer, or null on any
 *  failure (treated upstream as a missing/UNSURE attempt — never a drop). */
async function coldAnswerOnce(
  client: NonNullable<ReturnType<typeof getAnthropicClient>>,
  questionText: string,
  temperature: number,
): Promise<string | null> {
  try {
    const response = await loggedMessagesCreate(
      client,
      'ask-to-answer-cold',
      {
        model: HAIKU_MODEL,
        max_tokens: 60,
        temperature,
        system: COLD_ANSWER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: wrapUserInput('question', questionText) }],
      },
      { timeoutMs: HAIKU_GATE_TIMEOUT_MS },
    );
    const text = extractTextContent(response.content).trim();
    return text.length > 0 ? text.slice(0, 200) : null;
  } catch {
    return null;
  }
}

export function parseJudgeResponse(
  raw: string,
  batchSize: number,
): { verified: Set<number>; toDrop: Set<number>; reasons: Record<number, string> } {
  const verified = new Set<number>();
  const toDrop = new Set<number>();
  const reasons: Record<number, string> = {};
  const parsed = parseJsonObject(raw);
  if (!parsed) return { verified, toDrop, reasons };

  const collect = (value: unknown, into: Set<number>) => {
    if (!Array.isArray(value)) return;
    for (const v of value) {
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < batchSize) into.add(v);
    }
  };
  collect(parsed.pass_indices, verified);
  collect(parsed.drop_indices, toDrop);
  // A clear DROP wins over a contradictory PASS for the same index (fail toward
  // not-serving a question whose correctness the judge doubts).
  for (const idx of toDrop) verified.delete(idx);

  const rawReasons = parsed.reasons;
  if (rawReasons && typeof rawReasons === 'object' && !Array.isArray(rawReasons)) {
    for (const [key, value] of Object.entries(rawReasons as Record<string, unknown>)) {
      const idx = Number.parseInt(key, 10);
      if (Number.isInteger(idx) && idx >= 0 && idx < batchSize && typeof value === 'string') {
        reasons[idx] = value.slice(0, 200);
      }
    }
  }
  return { verified, toDrop, reasons };
}

/**
 * Run the ask-to-answer gate over a batch. Cold answers are sampled per question
 * in parallel; a single batched judge call then renders the per-item verdict.
 *
 * Fail-open contract: returns empty sets (drop nothing, verify nothing) when the
 * gate is disabled, no client is configured, or the judge call fails.
 */
export async function askToAnswerBatch(
  items: AskToAnswerItem[],
  config: AskToAnswerConfig = getAskToAnswerConfig(),
): Promise<AskToAnswerResult> {
  const empty: AskToAnswerResult = {
    toDrop: new Set(),
    verified: new Set(),
    variantsByIndex: new Map(),
    reasons: {},
  };
  if (!config.enabled || items.length === 0) return empty;
  const client = getAnthropicClient();
  if (!client) return empty;

  // Cold attempts: items × samples, all in parallel.
  const coldByItem = await Promise.all(
    items.map((item) =>
      Promise.all(
        Array.from({ length: config.samples }, () =>
          coldAnswerOnce(client, item.questionText, config.coldTemperature),
        ),
      ),
    ),
  );

  // If every cold attempt failed (full outage), fail open — don't drop anything.
  const anyColdSucceeded = coldByItem.some((attempts) => attempts.some((a) => a !== null));
  if (!anyColdSucceeded) return empty;

  const body = items
    .map((item, i) => {
      const attempts = coldByItem[i]
        .map((a, j) => `      cold_${j + 1}=${a ?? 'UNSURE'}`)
        .join('\n');
      return `[${i}] question=${item.questionText}\n    stored_answer=${item.answer}\n${attempts}`;
    })
    .join('\n\n');

  try {
    const response = await loggedMessagesCreate(
      client,
      'ask-to-answer-judge',
      {
        model: HAIKU_MODEL,
        max_tokens: 600,
        temperature: 0,
        system: JUDGE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: wrapUserInput('batch', body) }],
      },
      { timeoutMs: HAIKU_GATE_TIMEOUT_MS },
    );
    const parsed = parseJudgeResponse(extractTextContent(response.content), items.length);
    return {
      ...parsed,
      variantsByIndex: extractVariants(parsed.verified, items, coldByItem),
    };
  } catch (err) {
    // Fail open: a judge outage must not drop questions. They stay unverified.
    console.warn('[daily/ask-to-answer] judge call failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return empty;
  }
}

const MAX_VARIANTS = 4;

/**
 * For each verified item, the distinct cold answers minus the stored answer form
 * acceptable_variant seeds (the judge already deemed them equivalent). Normalized
 * (trimmed), case-insensitively deduped, UNSURE/empty dropped, capped.
 */
export function extractVariants(
  verified: Set<number>,
  items: AskToAnswerItem[],
  coldByItem: (string | null)[][],
): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const i of verified) {
    const stored = items[i].answer.trim().toLowerCase();
    const seen = new Set<string>([stored]);
    const variants: string[] = [];
    for (const raw of coldByItem[i] ?? []) {
      if (!raw) continue;
      const trimmed = raw.trim();
      const key = trimmed.toLowerCase();
      if (!trimmed || key === 'unsure' || seen.has(key)) continue;
      seen.add(key);
      variants.push(trimmed);
      if (variants.length >= MAX_VARIANTS) break;
    }
    if (variants.length > 0) out.set(i, variants);
  }
  return out;
}

/**
 * Resolve the trust tier a freshly-generated machine row should enter at
 * (PRD-D-5 §6). A row earns `machine_verified` when an independent signal
 * corroborates its answer: it passed ask-to-answer agreement, OR it is
 * retrieval-corroborated (B3 source corroboration floor met). Either positive
 * signal alone promotes — requiring BOTH would starve self-practice whenever
 * retrieval grounding is disabled (Drift Risk 1), and is strictly stronger than
 * B1's grandfather baseline (which promoted rows with neither signal). Rows with
 * no positive signal stay `unverified`.
 */
export function resolveMachineTrustTier(args: {
  askToAnswerVerified: boolean;
  corroborated: boolean;
}): 'unverified' | 'machine_verified' {
  return args.askToAnswerVerified || args.corroborated ? 'machine_verified' : 'unverified';
}
