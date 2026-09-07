/**
 * Rewrite proposer for the 2026-09-07 bank sweep's WORDING-defect demotions
 * (diagnosis/answer-leak-domain-drift-plan.md).
 *
 * `salvage-question.ts`'s proposeSalvage is a DIFFERENT job: it deletes one
 * wrong decorative fact and its hard rule is "NEVER change the stated answer."
 * That's wrong for this defect family — an answer-leak or definition-supplied
 * question is broken because of how the STEM is worded (or, for a sentence-
 * shaped answer, how the ANSWER is worded), and the fix is a targeted rewrite,
 * not a deletion. This proposer's job is: same underlying fact, same thing
 * being tested, defect removed.
 *
 * Scope: only the WORDING-fixable defect classes from the sweep — a leaked/
 * self-answering/definition-supplied stem, a bundled multi-part ask, a
 * misleading clause, or a sentence-shaped answer. NOT called for
 * FALSE_PREMISE (the content is actually wrong), OPINION_OR_VAGUE (no single
 * answer to preserve), GENERIC_AT_TIER (a difficulty-tier problem, not a
 * wording one), or OFF_DOMAIN (a filing problem — the content is fine).
 *
 * Fail-closed toward SAFETY, same contract as proposeSalvage: any
 * client/parse/uncertainty fault returns `unsalvageable` with no proposed
 * text, so a fault can never fabricate a "fix". The caller re-verifies the
 * PROPOSED text before ever applying it — this module only proposes.
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

export type BankRewriteKind = 'rewritten' | 'unsalvageable';

export type BankRewriteInput = {
  questionText: string;
  answer: string;
  explainer: string | null;
  /** The exact demotion reason, e.g. "DEFINITION_SUPPLIED: the setup fully describes...". */
  defectReason: string;
  canonicalSubcategory: string | null;
  broadCategory: string | null;
};

export type BankRewriteProposal = {
  kind: BankRewriteKind;
  /** Full replacement stem, or null if unchanged/unsalvageable. */
  proposedQuestionText: string | null;
  /** Full replacement answer, or null if unchanged/unsalvageable. */
  proposedAnswer: string | null;
  /** Full replacement explainer, or null if unchanged/unsalvageable. */
  proposedExplainer: string | null;
  note: string;
};

const UNSALVAGEABLE: BankRewriteProposal = {
  kind: 'unsalvageable',
  proposedQuestionText: null,
  proposedAnswer: null,
  proposedExplainer: null,
  note: 'no safe rewrite',
};

const REWRITE_TIMEOUT_MS = 30_000;

const SYSTEM_PROMPT = `You repair trivia questions that a quality gate demoted for a WORDING defect — the underlying fact is fine, but the stem or answer is phrased in a way that breaks the question. You are given the question, its answer, its explainer, the subject/domain, and the exact defect the gate found. Rewrite to fix ONLY that defect while testing the SAME underlying fact.

The defect will be one of:
- ANSWER_LEAKED / SELF_ANSWERING / a partial-leak note ("gives away answer") — the stem contains the answer, a near-paraphrase of it, or hands over its discriminating word(s). Reword the stem so the fact must actually be recalled, not read off the page. Keep the same angle on the same fact if you can; if the only way to ask about this fact leaks the answer, it is UNSALVAGEABLE.
- DEFINITION_SUPPLIED — the stem describes the answer so completely that naming it is a relabel, not a recall. Strip the setup down so real identification work remains, or re-aim the question at a narrower/different angle on the SAME subject that still requires recall. If nothing about this fact can be asked without supplying its own definition, it is UNSALVAGEABLE.
- MULTI_PART — the stem bundles two distinct asks into one. Cut to the SINGLE better ask and drop the other; keep the SAME answer if it still answers the remaining ask, otherwise this defect is not cleanly fixable by trimming — mark UNSALVAGEABLE rather than invent a new fact to answer the leftover ask.
- MISLEADING_SETUP — a clause in the stem most naturally points to a different answer than the intended one. Reword or cut that clause so the stem no longer misdirects.
- "answer is a sentence, not one clean answer" (a shape defect) — the ANSWER field is a paragraph/sentence rather than a short checkable response. Shorten the answer to a clean name/term/short phrase — the core noun phrase the sentence was building to — and adjust the question's wording only as needed so the shortened answer still cleanly answers it. Do not invent a new fact; extract what the sentence was already saying.

HARD RULES:
- The fact being tested must not change. You may adjust or shorten the ANSWER field only to fix a shape defect (a sentence → a clean answer) or when trimming a MULTI_PART stem to its single remaining ask — never to dodge a leak by testing a different, easier fact.
- Change as little as necessary. Do not rewrite tone, add color, or "improve" anything the defect reason did not flag.
- If you cannot fix the stated defect without testing a different fact, inventing new content, or producing an answer that no longer matches what a knowledgeable player would say, return UNSALVAGEABLE. Do not guess or force a fix.
- The rewritten stem must still name its source work/franchise where the original did (self-containment is not the defect being fixed here — don't regress it).

Return JSON only, nothing else:
{ "kind": "rewritten" | "unsalvageable",
  "proposed_question_text": "<full rewritten stem, or null if unchanged/unsalvageable>",
  "proposed_answer": "<full rewritten answer, or null if unchanged>",
  "proposed_explainer": "<full rewritten explainer, or null if unchanged>",
  "note": "<short: what you changed, or why it can't be fixed>" }${INSTRUCTION_USER_INPUT_GUIDANCE}${INSTRUCTION_SCOPING_QUALIFIER}`;

function buildUserMessage(input: BankRewriteInput): string {
  return [
    wrapUserInput('question', input.questionText),
    wrapUserInput('stated_answer', input.answer),
    input.explainer ? wrapUserInput('explainer', input.explainer) : '',
    input.canonicalSubcategory
      ? wrapUserInput(
          'subject',
          `${input.canonicalSubcategory}${input.broadCategory ? ` (${input.broadCategory})` : ''}`,
        )
      : '',
    wrapUserInput('defect', input.defectReason),
    'Propose the rewrite or declare it unsalvageable. Return JSON only.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Pure: parse + validate the proposer's JSON. Exported for unit tests. */
export function parseBankRewriteResponse(raw: string): BankRewriteProposal | null {
  const parsed = parseJsonObject(raw);
  if (!parsed) return null;
  const kind = parsed.kind;
  if (kind !== 'rewritten' && kind !== 'unsalvageable') return null;
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
  const note = typeof parsed.note === 'string' ? parsed.note.trim().slice(0, 300) : '';

  if (kind === 'unsalvageable') {
    return {
      kind,
      proposedQuestionText: null,
      proposedAnswer: null,
      proposedExplainer: null,
      note: note || 'unsalvageable',
    };
  }

  const proposedQuestionText = str(parsed.proposed_question_text);
  const proposedAnswer = str(parsed.proposed_answer);
  const proposedExplainer = str(parsed.proposed_explainer);
  // A rewrite MUST actually change the stem or the answer — an edit that
  // touches only the explainer doesn't fix any defect this proposer handles.
  if (!proposedQuestionText && !proposedAnswer) {
    return { ...UNSALVAGEABLE, note: note || UNSALVAGEABLE.note };
  }
  return { kind, proposedQuestionText, proposedAnswer, proposedExplainer, note: note || 'rewritten' };
}

/**
 * Propose a rewrite for one demoted question. Never applies it — the caller
 * re-verifies the proposed text before persisting anything. Never throws;
 * any fault resolves to `unsalvageable` so an outage can only mean "no fix
 * offered," never a bad auto-edit reaching the DB.
 */
export async function proposeBankRewrite(input: BankRewriteInput): Promise<BankRewriteProposal> {
  const client = getAnthropicClient();
  if (!client) return UNSALVAGEABLE;

  try {
    const response = await loggedMessagesCreate(
      client,
      'bank-rewrite-propose',
      {
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(input) }],
      },
      { timeoutMs: REWRITE_TIMEOUT_MS },
    );
    return parseBankRewriteResponse(extractTextContent(response.content)) ?? UNSALVAGEABLE;
  } catch (error) {
    console.warn('[proposeBankRewrite] request_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return UNSALVAGEABLE;
  }
}
