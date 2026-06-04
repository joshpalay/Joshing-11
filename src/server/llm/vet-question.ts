/**
 * LLM vetting for user-authored questions. A single Haiku pass checks
 * factual correctness, quality, safety, and answer-not-in-question, and
 * returns a verdict the caller can map onto Question.publicStatus.
 *
 * Approved (publicStatus = 'eligible_pending') questions are eligible to
 * appear in any user's Daily 5; the daily orchestrator prioritises ones
 * authored by the viewer's friends and friends-of-friends.
 *
 * On Haiku error or `factual = 'unknown'` we leave the question at the
 * default 'not_scored' so a nightly sweep can retry — auto-approving on
 * uncertainty would let bad questions reach strangers.
 */

import {
  HAIKU_MODEL,
  HAIKU_GATE_TIMEOUT_MS,
  INSTRUCTION_USER_INPUT_GUIDANCE,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
  parseJsonObject,
  wrapUserInput,
} from '@/lib/llm';

export { verdictToPublicStatus } from '@/server/llm/vet-verdict';
export type { VetVerdict } from '@/server/llm/vet-verdict';
import type { VetVerdict } from '@/server/llm/vet-verdict';

export type VetQuestionInput = {
  questionText: string;
  answer: string;
  alternateAnswers?: string[];
  explanation?: string | null;
  broadCategory?: string | null;
  canonicalSubcategory?: string | null;
};

const QUALITY_APPROVAL_THRESHOLD = 0.5;

const SYSTEM_PROMPT = `You are a strict reviewer for a personal trivia game. A user has submitted a question that may be shown to other players (including strangers). Decide whether it is safe and good enough to enter the shared question pool.

Evaluate four independent dimensions and return JSON only.

1. factual: "pass" | "fail" | "unknown"
   - "pass" — the stated answer is correct and the question is unambiguous.
   - "fail" — the stated answer is wrong, or the question has multiple equally-valid answers and the given one isn't clearly "the" answer.
   - "unknown" — you genuinely cannot verify the fact (extremely niche, recent, or personal).

2. quality: number 0..1
   - Specific, well-formed, interesting trivia → high.
   - Vague, low-effort, opinion-based, gibberish, or extremely well-known → low.

3. safety: "pass" | "fail"
   - "fail" for slurs, harassment, sexual content involving minors, doxxing, or content targeting a private individual.
   - Ordinary edgy humour is fine; this is a friend game.

4. answer_leaked: boolean
   - true if the question text contains the answer or near-paraphrase.

Also emit:
- overall_score: number 0..1 — your composite confidence the question belongs in a shared pool.
- reason: short single sentence explaining the verdict (≤ 140 chars), human-readable, no markdown.

Return only valid JSON with keys: factual, quality, safety, answer_leaked, overall_score, reason. No prose outside the object.${INSTRUCTION_USER_INPUT_GUIDANCE}`;

function buildUserMessage(input: VetQuestionInput): string {
  const lines = [
    wrapUserInput('question', input.questionText),
    wrapUserInput('stated_answer', input.answer),
  ];
  if (input.alternateAnswers && input.alternateAnswers.length > 0) {
    lines.push(wrapUserInput('accepted_alternates', input.alternateAnswers.join(' | ')));
  }
  if (input.explanation) {
    lines.push(wrapUserInput('author_explanation', input.explanation));
  }
  if (input.canonicalSubcategory) {
    lines.push(wrapUserInput('categorised_as', `${input.canonicalSubcategory}${input.broadCategory ? ` (${input.broadCategory})` : ''}`));
  }
  lines.push('Vet this submission. Return JSON only.');
  return lines.join('\n');
}

function clamp01(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function trimmed(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const t = value.trim();
  return t.length > 0 ? t.slice(0, 240) : fallback;
}

function asFactual(value: unknown): 'pass' | 'fail' | 'unknown' | null {
  return value === 'pass' || value === 'fail' || value === 'unknown' ? value : null;
}

function asPassFail(value: unknown): 'pass' | 'fail' | null {
  return value === 'pass' || value === 'fail' ? value : null;
}

export async function vetQuestion(input: VetQuestionInput): Promise<VetVerdict> {
  const client = getAnthropicClient();
  if (!client) {
    return { status: 'needs_review', score: null, reason: 'llm_disabled' };
  }

  let response;
  try {
    // ~700 tokens — below Haiku's 2048 cacheable threshold; plain string.
    response = await loggedMessagesCreate(client, 'vet-question', {
      model: HAIKU_MODEL,
      max_tokens: 400,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(input) }],
    }, { timeoutMs: HAIKU_GATE_TIMEOUT_MS });
  } catch (error) {
    console.warn('[vetQuestion] request_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { status: 'needs_review', score: null, reason: 'llm_error' };
  }

  const parsed = parseJsonObject(extractTextContent(response.content));
  if (!parsed) {
    return { status: 'needs_review', score: null, reason: 'invalid_llm_json' };
  }

  const factual = asFactual(parsed.factual);
  const safety = asPassFail(parsed.safety);
  if (!factual || !safety) {
    return { status: 'needs_review', score: null, reason: 'missing_fields' };
  }

  const quality = clamp01(parsed.quality, 0);
  const overall = clamp01(parsed.overall_score, quality);
  const answerLeaked = parsed.answer_leaked === true;
  const reason = trimmed(parsed.reason, 'vetted');

  // Hard rejects first. rejectionKind discriminates which dimension failed;
  // only 'safety' triggers the visibility hard-block downstream (the others
  // stay public-pool signals that remain shareable to friends).
  if (factual === 'fail') return { status: 'rejected', score: overall, reason: `factual: ${reason}`, rejectionKind: 'factual' };
  if (safety === 'fail') return { status: 'rejected', score: overall, reason: `safety: ${reason}`, rejectionKind: 'safety' };
  if (answerLeaked) return { status: 'rejected', score: overall, reason: `answer in question: ${reason}`, rejectionKind: 'answer_leaked' };
  if (quality < QUALITY_APPROVAL_THRESHOLD) {
    return { status: 'rejected', score: overall, reason: `quality ${quality.toFixed(2)}: ${reason}`, rejectionKind: 'quality' };
  }

  // Cannot verify the fact, but no other red flags — let a human (or a later
  // sweep) decide. Better to under-show than to push wrong trivia to strangers.
  if (factual === 'unknown') {
    return { status: 'needs_review', score: overall, reason: `unverifiable: ${reason}` };
  }

  return { status: 'approved', score: overall, reason };
}

