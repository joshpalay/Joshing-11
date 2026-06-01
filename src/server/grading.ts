/**
 * Answer grading — LLM primary, exact-match fast-path for obvious hits.
 * PRD 8.9: answers graded immediately on submission; result shown in session UI.
 * PRD 9.3: case insensitivity, accepted_alternatives treated as correct.
 * PRD 9 / Prompt 1: lenient grader via claude-sonnet-4-6, fallback to 'wrong' on error.
 */

import { gradeAnswerWithLLM } from '@/lib/llm';

export type GradeResult = 'correct' | 'wrong';

export type GradeOutcome = {
  result: GradeResult;
  // "Snarky but Sweet" consolation for thematically-close wrong answers (null otherwise)
  consolation: string | null;
  // 0..1 from the LLM, or 1 for exact-match. 0 when grading fell back to a
  // deterministic 'wrong' verdict due to an LLM error.
  confidence: number;
  // 'exact' — exact-match fast-path; 'llm' — model verdict;
  // 'fallback' — model couldn't be reached (timeout, parse error, no client).
  // Consumers wanting to soften UX on LLM outages should branch on 'fallback'
  // (e.g. auto-route to /api/daily/recheck, or hold scoring pending review).
  gradedVia: 'exact' | 'llm' | 'fallback';
};

/**
 * Fast-path exact match before calling the LLM.
 * Returns true if the submission is an obvious exact/alternative match.
 */
function exactMatch(
  submitted: string,
  canonicalAnswer: string,
  acceptedAlternatives: string[],
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
  questionType: string = 'factual',
): Promise<GradeOutcome> {
  if (!submitted.trim()) {
    return { result: 'wrong', consolation: null, confidence: 1, gradedVia: 'exact' };
  }

  // Fast-path: skip the LLM for obvious exact matches and accepted alternatives
  if (exactMatch(submitted, canonicalAnswer, acceptedAlternatives)) {
    return { result: 'correct', consolation: null, confidence: 1, gradedVia: 'exact' };
  }

  const llmResult = await gradeAnswerWithLLM(
    questionText,
    canonicalAnswer,
    submitted,
    questionType,
  ).catch((error) => {
    console.warn('[grading] LLM grading call failed; using deterministic fallback', {
      name: error instanceof Error ? error.name : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      result: 'wrong' as const,
      confidence: 0,
      reason: 'llm_error',
      consolation: null,
      fallback: true,
    };
  });
  return {
    result: llmResult.result,
    consolation: llmResult.consolation ?? null,
    confidence: llmResult.confidence,
    gradedVia: llmResult.fallback ? 'fallback' : 'llm',
  };
}
