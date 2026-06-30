// Answer-key enrichment gate (Fix 3) — prevent multi-answer questions from
// shipping with an incomplete key.
//
// The first-pass grader (src/server/grading.ts) grades a submission ONLY against
// the stored answer + accepted_alternatives; it never reasons about whether some
// OTHER answer would also be correct for the question. So when a generated
// question genuinely has more than one correct answer but only one is encoded —
// e.g. "In TNG's 'The Measure of a Man,' what does Riker do that shocks the
// courtroom?" where both "detaches Data's arm" AND "switches Data off" are
// correct, and the question's own explainer names both — a player giving the
// other valid answer is marked wrong until they appeal.
//
// ask-to-answer (src/server/daily/ask-to-answer.ts) does NOT cover this: it
// captures the same answer phrased differently (cold solvers converging on one
// answer), and treats genuinely-divergent-but-both-correct answers as instability
// — it would not promote them into the key. This gate is the additive piece: it
// asks, per question, for the OTHER answers a strict-but-fair grader must accept,
// and merges them into acceptable_variants at persist time.
//
// Safety: this produces UNVERIFIED alternates (unlike ask-to-answer variants,
// which the judge deemed equivalent). The prompt is therefore deliberately
// strict — only answers that are unambiguously, independently correct answers to
// the question AS WORDED, never broader/vaguer forms or merely-related facts.
// Fail-open like every other generation gate: an outage adds nothing (the
// question still ships with its original key), it never blocks or drops.

import {
  INSTRUCTION_SCOPING_QUALIFIER,
  INSTRUCTION_USER_INPUT_GUIDANCE,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
  parseJsonObject,
  wrapUserInput,
} from '@/lib/llm';

export interface EnrichVariantsItem {
  questionText: string;
  answer: string;
  explainer: string;
}

// Default to the generation tier (Sonnet) — judging answer equivalence needs the
// same reasoning the generator and factual gate use; Haiku is too lenient/broad
// here and would risk polluting keys. Overridable without a deploy, mirroring
// FACTUAL_GATE_MODEL. Resolved lazily so tests can stub the model id.
function enrichModel(): string {
  return process.env.ENRICH_VARIANTS_MODEL?.trim() || 'claude-sonnet-4-6';
}

function enrichEnabled(): boolean {
  const raw = process.env.ENRICH_VARIANTS_ENABLED?.trim().toLowerCase();
  if (raw === undefined || raw === '') return true;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

// Opus 4.7/4.8 and Fable reject sampling params — sending `temperature` 400s.
function modelRejectsTemperature(model: string): boolean {
  return model.includes('opus-4-7') || model.includes('opus-4-8') || model.includes('fable');
}

const ENRICH_TIMEOUT_MS = 20_000;
const ENRICH_MAX_TOKENS = 2000;
// An accepted alternative is an answer-key entry, not a sentence; cap length and
// count so an over-eager model can't bloat the key (and every future grade's
// leniency surface).
const MAX_VARIANTS_PER_ITEM = 4;
const MAX_VARIANT_LENGTH = 120;

const ENRICH_SYSTEM_PROMPT = `You harden the answer key for trivia questions whose phrasing admits more than one correct answer.

For each item you get the question, the stored canonical answer, and an explainer. List ONLY additional answers that a fair grader MUST accept as fully correct for the question AS WORDED — distinct correct responses, not rephrasings of the stored answer (the grader already handles spelling/abbreviation/word-order variants itself).

Add an answer ONLY when:
- It is an unambiguously, independently correct answer to exactly what the question asks (e.g. the question describes an act with two equally-valid descriptions, or names a thing that has a second accepted name the stored answer omitted), AND
- The explainer or the question itself supports it as correct.

NEVER add:
- A broader, vaguer, or partial form of the stored answer (e.g. "a horse" for "Bucephalus", "gluteus" for "gluteus maximus").
- A merely-related, adjacent, or "also true but not what was asked" fact.
- A rephrasing, abbreviation, alternate spelling, or translation of the stored answer (the grader handles those).
- Anything you are not confident a strict grader should accept. When in doubt, add nothing.

Most questions have exactly one correct answer — for those, return an empty list. Be conservative: a wrong entry here makes the grader accept genuinely-wrong answers forever, which is worse than a missing one.

Return JSON only:
{ "variants": { "<index>": ["<additional correct answer>", ...] } }
Omit any index with no additions. Each answer must be SHORT (an answer, not a sentence).${INSTRUCTION_USER_INPUT_GUIDANCE}${INSTRUCTION_SCOPING_QUALIFIER}`;

export function parseEnrichResponse(
  raw: string,
  batchSize: number,
  items: EnrichVariantsItem[],
): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const parsed = parseJsonObject(raw);
  if (!parsed) return out;
  const variants = parsed.variants;
  if (!variants || typeof variants !== 'object' || Array.isArray(variants)) return out;

  for (const [key, value] of Object.entries(variants as Record<string, unknown>)) {
    const idx = Number.parseInt(key, 10);
    if (!Number.isInteger(idx) || idx < 0 || idx >= batchSize) continue;
    if (!Array.isArray(value)) continue;

    // Dedup case-insensitively against the stored answer and within the list, so
    // we never re-add the canonical answer or a duplicate.
    const stored = items[idx].answer.trim().toLowerCase();
    const seen = new Set<string>([stored]);
    const cleaned: string[] = [];
    for (const entry of value) {
      if (typeof entry !== 'string') continue;
      const trimmed = entry.trim();
      const lower = trimmed.toLowerCase();
      if (!trimmed || trimmed.length > MAX_VARIANT_LENGTH || seen.has(lower)) continue;
      seen.add(lower);
      cleaned.push(trimmed);
      if (cleaned.length >= MAX_VARIANTS_PER_ITEM) break;
    }
    if (cleaned.length > 0) out.set(idx, cleaned);
  }
  return out;
}

/**
 * Enumerate additional genuinely-correct answers for each question and return
 * them keyed by batch index, for merging into `acceptable_variants` at persist
 * time. One batched call per generation batch (cost parity with the factual
 * gate). Fail-open: returns an empty map when disabled, when no client is
 * configured, or on any LLM/parse failure.
 */
export async function enrichAcceptableVariants(
  items: EnrichVariantsItem[],
): Promise<Map<number, string[]>> {
  if (!enrichEnabled() || items.length === 0) return new Map();
  const client = getAnthropicClient();
  if (!client) return new Map();

  const model = enrichModel();
  const body = items
    .map(
      (q, i) =>
        `[${i}] q=${q.questionText}\n    a=${q.answer}\n    explainer=${q.explainer}`,
    )
    .join('\n\n');

  try {
    const response = await loggedMessagesCreate(
      client,
      'enrich-variants',
      {
        model,
        max_tokens: ENRICH_MAX_TOKENS,
        ...(modelRejectsTemperature(model) ? {} : { temperature: 0 }),
        system: ENRICH_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: wrapUserInput('batch', body) }],
      },
      { timeoutMs: ENRICH_TIMEOUT_MS },
    );
    if (response.stop_reason === 'max_tokens') {
      // A truncated verdict parses to an empty/partial map — the batch just ships
      // with its original keys. Surface it so the cap can be raised if it recurs.
      console.warn('[daily/enrich-variants] response truncated at max_tokens — some keys not enriched', {
        batchSize: items.length,
        maxTokens: ENRICH_MAX_TOKENS,
      });
    }
    return parseEnrichResponse(extractTextContent(response.content), items.length, items);
  } catch (err) {
    console.warn('[daily/enrich-variants] enrichment failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return new Map();
  }
}

/** Union two variant lists with case-insensitive dedup, capping the result.
 *  Used at the persist loop to merge ask-to-answer variants with enrichment. */
export function mergeVariants(...lists: (string[] | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const entry of list ?? []) {
      const trimmed = entry.trim();
      const lower = trimmed.toLowerCase();
      if (!trimmed || seen.has(lower)) continue;
      seen.add(lower);
      out.push(trimmed);
    }
  }
  return out;
}
