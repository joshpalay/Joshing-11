import type { AnswerState } from '@/types/db';

type AnswerResult = 'correct' | 'wrong' | 'expired';

function isCorrectResult(result: AnswerResult): boolean {
  return result === 'correct';
}

/**
 * Computes answer_state at insert time (B9). Prior rows are all answers for the same
 * user + question, ordered oldest-first (answered_at, then id).
 */
export function computeAnswerState(
  currentResult: AnswerResult,
  priorAnswers: readonly { result: AnswerResult }[]
): AnswerState {
  if (!isCorrectResult(currentResult)) {
    return 'incorrect';
  }

  if (priorAnswers.length === 0) {
    return 'first_correct';
  }

  const anyPriorCorrect = priorAnswers.some((p) => isCorrectResult(p.result));
  if (anyPriorCorrect) {
    return 'repeat_correct';
  }

  return 'first_correct_after_wrong';
}

export type LiveAnswerMasteryCredit = 'first_correct' | 'first_correct_after_wrong';

export function liveMasteryCreditFromAnswerState(state: AnswerState): LiveAnswerMasteryCredit | null {
  if (state === 'first_correct') return 'first_correct';
  if (state === 'first_correct_after_wrong') return 'first_correct_after_wrong';
  return null;
}
