/**
 * Salvage proposer (D-QUALITY-SALVAGE-01) — the counterpart to the verifier.
 *
 * Most verifier demotions are not wrong answers: they are ONE non-load-bearing
 * fact — a decorative wrong year/count/attribution in the stem, or (more often)
 * in the explainer — while the ask and the headline answer are perfectly right.
 * Given the demoted question plus the verifier's own reason (which localizes the
 * bad fact), this proposes the MINIMAL edit that removes or corrects it while
 * leaving the answer untouched, and classifies whether the question is salvageable
 * at all. The proposal is never applied here — it is re-verified and then a human
 * approves it in the review queue (conservative).
 *
 * Fail-closed toward SAFETY: on any client/parse/uncertainty fault the result is
 * `unsalvageable` with no proposed text, so a fault can never fabricate a "fix".
 * Anthropic only; usage logged under scope 'salvage-propose'.
 */

import {
  ANTHROPIC_MODEL,
  INSTRUCTION_SCOPING_QUALIFIER,
  INSTRUCTION_USER_INPUT_GUIDANCE,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
  parseJsonObject,
  wrapUserInput,
} from '@/lib/llm';

export type SalvageKind = 'extra_fact_stem' | 'extra_fact_explainer' | 'unsalvageable';

export type SalvageInput = {
  questionText: string;
  answer: string;
  explanation?: string | null;
  verificationReason: string;
  canonicalSubcategory?: string | null;
  broadCategory?: string | null;
};

export type SalvageProposal = {
  kind: SalvageKind;
  /** Full proposed stem (null when the stem is unchanged or unsalvageable). */
  proposedStem: string | null;
  /** Full proposed explainer (null when unchanged or unsalvageable). */
  proposedExplanation: string | null;
  /** One short line of what was changed / why it can't be salvaged. */
  note: string;
};

const UNSALVAGEABLE: SalvageProposal = {
  kind: 'unsalvageable',
  proposedStem: null,
  proposedExplanation: null,
  note: 'no safe minimal fix',
};

const SALVAGE_TIMEOUT_MS = 30_000;

const SYSTEM_PROMPT = `You repair trivia questions that a fact-checker demoted. Most demotions are NOT a wrong answer — they are a single non-load-bearing fact ("smuggled" scaffolding: a decorative date, count, ordinal, superlative, attribution, or adjacent-work claim) that is wrong, usually in the explainer, while the actual ask and its headline answer are correct. Your job: propose the SMALLEST edit that makes the fact-checker pass, or declare the question unsalvageable.

You are given the question, its stated answer, its explainer, and the fact-checker's reason (which names the offending claim).

HARD RULES:
- NEVER change the stated answer, and never change what the question asks. If the fix would require changing the answer or the thing being asked, it is UNSALVAGEABLE.
- Prefer REMOVAL over correction: if the offending fact is not needed to identify the answer, delete that clause and stop. Correct it (using the fact-checker's stated correct value) ONLY when the fact is load-bearing to the ask.
- Change as little as possible. Do not rewrite, re-tone, or "improve" anything the fact-checker did not flag. Keep the rest verbatim.
- If the demotion is because the ANSWER itself is wrong, the premise the question hinges on is false, or you are not confident a minimal edit fixes it, return UNSALVAGEABLE. Do not guess.

Classify:
- "extra_fact_stem": you edited the stem (removed/corrected a bad fact there). Return the full proposed stem.
- "extra_fact_explainer": the stem is fine; you edited only the explainer. Return the full proposed explainer.
- "unsalvageable": no safe minimal fix.

(If both stem and explainer need trimming, edit both and use "extra_fact_stem".)

Return JSON only, nothing else:
{ "kind": "extra_fact_stem" | "extra_fact_explainer" | "unsalvageable",
  "proposed_stem": "<full edited stem, or null if unchanged/unsalvageable>",
  "proposed_explanation": "<full edited explainer, or null if unchanged/unsalvageable>",
  "note": "<short: what you removed/corrected, or why it can't be salvaged>" }${INSTRUCTION_USER_INPUT_GUIDANCE}${INSTRUCTION_SCOPING_QUALIFIER}`;

function buildUserMessage(input: SalvageInput): string {
  return [
    wrapUserInput('question', input.questionText),
    wrapUserInput('stated_answer', input.answer),
    input.explanation ? wrapUserInput('explainer', input.explanation) : '',
    input.canonicalSubcategory
      ? wrapUserInput(
          'subject',
          `${input.canonicalSubcategory}${input.broadCategory ? ` (${input.broadCategory})` : ''}`,
        )
      : '',
    wrapUserInput('fact_checker_reason', input.verificationReason),
    'Propose the minimal fix or declare it unsalvageable. Return JSON only.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Pure: parse + validate the proposer's JSON. Exported for unit tests. */
export function parseSalvageResponse(raw: string): SalvageProposal | null {
  const parsed = parseJsonObject(raw);
  if (!parsed) return null;
  const kind = parsed.kind;
  if (kind !== 'extra_fact_stem' && kind !== 'extra_fact_explainer' && kind !== 'unsalvageable') {
    return null;
  }
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
  const note = typeof parsed.note === 'string' ? parsed.note.trim().slice(0, 300) : '';

  if (kind === 'unsalvageable') {
    return { kind, proposedStem: null, proposedExplanation: null, note: note || 'unsalvageable' };
  }

  const proposedStem = str(parsed.proposed_stem);
  const proposedExplanation = str(parsed.proposed_explanation);
  // A salvage MUST actually propose replacement text; a "fix" with no changed
  // text is meaningless, so treat it as unsalvageable rather than a no-op edit.
  if (!proposedStem && !proposedExplanation) return { ...UNSALVAGEABLE, note: note || UNSALVAGEABLE.note };
  return { kind, proposedStem, proposedExplanation, note: note || 'minimal fix' };
}

/**
 * Propose a minimal salvage edit for one demoted question. Never applies it.
 * Returns `unsalvageable` (never throws) on any fault, so a proposer outage can
 * only ever mean "no fix offered", never a bad auto-edit.
 */
export async function proposeSalvage(input: SalvageInput): Promise<SalvageProposal> {
  const client = getAnthropicClient();
  if (!client) return UNSALVAGEABLE;

  try {
    const response = await loggedMessagesCreate(
      client,
      'salvage-propose',
      {
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(input) }],
      },
      { timeoutMs: SALVAGE_TIMEOUT_MS },
    );
    return parseSalvageResponse(extractTextContent(response.content)) ?? UNSALVAGEABLE;
  } catch (error) {
    console.warn('[proposeSalvage] request_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return UNSALVAGEABLE;
  }
}
