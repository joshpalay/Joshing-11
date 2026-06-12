/**
 * Answer grading — LLM primary, exact-match fast-path for obvious hits.
 * PRD 8.9: answers graded immediately on submission; result shown in session UI.
 * PRD 9.3: case insensitivity, accepted_alternatives treated as correct.
 * PRD 9 / Prompt 1: lenient grader via claude-sonnet-4-6; on infra failure the
 * grader returns an UNSCORED outcome (no `result`), never a 'wrong' verdict.
 */

import { gradeAnswerWithLLM } from '@/lib/llm';

// Mirrors questionTypeEnum in src/server/db/schema.ts. The grader's leniency
// policy branches on this (a 'personal' question's canonical answer is the
// creator's intended answer, not objective truth), so callers MUST pass the
// question's stored type — there is deliberately no default. Generated bot
// questions (generatedQuestions has no question_type column) are factual by
// construction and pass the literal 'factual'.
export type GradableQuestionType = 'factual' | 'personal' | 'ambiguous' | 'factual_uncertain';

export type GradeResult = 'correct' | 'wrong';

// A genuine, scored verdict — exact-match hit/miss or a real model judgement.
// `result` is meaningful and may be acted on: a 'wrong' here is a real wrong.
export type ScoredGrade = {
  status: 'scored';
  result: GradeResult;
  // "Snarky but Sweet" consolation for thematically-close wrong answers (null otherwise)
  consolation: string | null;
  // 0..1 from the LLM, or 1 for exact-match.
  confidence: number;
  // 'exact' — exact-match fast-path; 'llm' — model verdict. Retained for
  // analytics; it is NO LONGER the only thing standing between an outage and a
  // wrong score (that is now the `status` discriminant below).
  gradedVia: 'exact' | 'llm';
};

// The grader could not reach a verdict (timeout, parse error, no client). This
// is an infrastructure event, NOT a judgement of the answer, so it carries no
// `result` field — accessing `.result` here is a compile error. Routes MUST
// branch on `status === 'unscored'` and hold the answer for retry rather than
// persist a verdict the model never gave.
export type UnscoredGrade = {
  status: 'unscored';
  reason: string;
};

export type GradeOutcome = ScoredGrade | UnscoredGrade;

/**
 * Fast-path exact match before calling the LLM.
 * Returns true if the submission is an obvious exact/alternative match.
 */
function exactMatch(
  submitted: string,
  canonicalAnswer: string,
  acceptedAlternatives: string[]
): boolean {
  const normalized = submitted.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === canonicalAnswer.trim().toLowerCase()) return true;
  return acceptedAlternatives.some((alt) => alt.trim().toLowerCase() === normalized);
}

/**
 * Grade a submitted answer.
 * Uses exact-match fast-path first, then LLM for nuanced cases.
 * Returns the result and an optional consolation quip for near-miss wrong answers.
 */
export async function gradeAnswer(
  submitted: string,
  canonicalAnswer: string,
  acceptedAlternatives: string[],
  questionText: string,
  questionType: GradableQuestionType
): Promise<GradeOutcome> {
  // An empty submission is a genuine, deliberate wrong — a real scored verdict,
  // not an infra failure. (The daily give-up path is the analogous deliberate
  // wrong on its own route.)
  if (!submitted.trim()) {
    return { status: 'scored', result: 'wrong', consolation: null, confidence: 1, gradedVia: 'exact' };
  }

  // Fast-path: skip the LLM for obvious exact matches and accepted alternatives
  if (exactMatch(submitted, canonicalAnswer, acceptedAlternatives)) {
    return { status: 'scored', result: 'correct', consolation: null, confidence: 1, gradedVia: 'exact' };
  }

  const llmResult = await gradeAnswerWithLLM(
    questionText,
    canonicalAnswer,
    submitted,
    questionType,
    acceptedAlternatives
  ).catch((error): UnscoredGrade => {
    console.warn('[grading] LLM grading call failed; holding answer unscored', {
      name: error instanceof Error ? error.name : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
    return { status: 'unscored', reason: 'llm_error' };
  });

  // Infra failure (timeout, parse error, no client) — never a scored verdict.
  if (llmResult.status === 'unscored') {
    return { status: 'unscored', reason: llmResult.reason };
  }

  return {
    status: 'scored',
    result: llmResult.result,
    consolation: llmResult.consolation ?? null,
    confidence: llmResult.confidence,
    gradedVia: 'llm',
  };
}
