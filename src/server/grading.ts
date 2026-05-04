/**
 * Answer grading — LLM primary, exact-match fast-path for obvious hits.
 * PRD 8.9: answers graded immediately on submission; result shown in session UI.
 * PRD 9.3: case insensitivity, accepted_alternatives treated as correct.
 * PRD 9 / Prompt 1: lenient grader via claude-sonnet-4-6, fallback to 'wrong' on error.
 */

import { gradeAnswerWithLLM } from '@/lib/llm';

export type GradeResult = 'correct' | 'wrong';
export type Surface = 'daily' | 'feed' | 'joshing_game';
export type FriendResult = 'correct' | 'incorrect' | null;

export type GradeOutcome = {
  result: GradeResult;
  // "Snarky but Sweet" consolation for thematically-close wrong answers (null otherwise)
  consolation: string | null;
};

function randomFrom<T>(options: readonly T[]): T {
  return options[Math.floor(Math.random() * options.length)];
}

export function selectQuip(isCorrect: boolean, _surface: Surface, friendResult: FriendResult): string {
  if (isCorrect && friendResult === null)
    return randomFrom(["That's your ground.", "Knew it.", "Of course you did.", "Solid.", "There it is."]);
  if (!isCorrect && friendResult === null)
    return randomFrom(["Now you know.", "Close. It'll come.", "Good question.", "That one's yours now."]);
  if (isCorrect && friendResult === 'correct')
    return randomFrom(["Same wavelength.", "You both had it.", "Common ground."]);
  if (isCorrect && friendResult === 'incorrect')
    return randomFrom(["You carried that one.", "You had it."]);
  if (!isCorrect && friendResult === 'correct')
    return randomFrom(["Good question.", "They had it. You'll get there."]);
  // !isCorrect && friendResult === 'incorrect'
  return randomFrom(["Neither of you. Good question.", "That one got you both.", "Tough one."]);
}

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
  questionType: string = 'factual'
): Promise<GradeOutcome> {
  if (!submitted.trim()) return { result: 'wrong', consolation: null };

  // Fast-path: skip the LLM for obvious exact matches and accepted alternatives
  if (exactMatch(submitted, canonicalAnswer, acceptedAlternatives)) {
    return { result: 'correct', consolation: null };
  }

  const { result, consolation } = await gradeAnswerWithLLM(
    questionText,
    canonicalAnswer,
    submitted,
    questionType
  ).catch((error) => {
    console.warn('[grading] LLM grading call failed; using deterministic fallback', {
      name: error instanceof Error ? error.name : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
    return { result: 'wrong' as const, confidence: 0, reason: 'llm_error', consolation: null };
  });
  return { result, consolation: consolation ?? null };
}
