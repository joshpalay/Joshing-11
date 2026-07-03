/**
 * B-REVIEW-RERUN-01 — the admin "re-run through the LLM" step on the review
 * queue. Given an edited question, produce a fresh answer + explanation AND a
 * grounded verification verdict, so the reviewer sees whether the reworked
 * question holds up BEFORE approving it back into circulation. Persists
 * nothing — this is the "what would the machine say now?" preview; the human's
 * Approve is the commit.
 */

import { suggestQuestionAnswer } from '@/server/llm/suggest-question';
import { verifyQuestion } from '@/server/quality/verify-question';

export type RerunResult = {
  suggestedAnswer: string;
  alternateAnswers: string[];
  explanation: string;
  // The verifier's verdict on (question, the answer we verified). 'ok' = safe
  // to circulate; 'demoted' = still wrong; 'unverifiable' = couldn't settle.
  verdict: 'ok' | 'demoted' | 'unverifiable';
  reason: string;
  usedWeb: boolean;
  // Which answer the verdict was computed against — the admin's override if
  // they supplied one, otherwise the LLM's suggestion.
  verifiedAnswer: string;
};

export async function rerunQuestion(input: {
  questionText: string;
  // The admin's current answer, if they want to keep it. When present the
  // verdict is computed against THIS answer; when absent, against the LLM's own
  // suggestion. The suggestion is returned either way so the admin can adopt it.
  answerText?: string | null;
  canonicalSubcategory?: string | null;
  broadCategory?: string | null;
}): Promise<RerunResult | null> {
  let suggestion: { correctAnswer: string; alternateAnswers: string[]; explanation: string };
  try {
    suggestion = await suggestQuestionAnswer(input.questionText);
  } catch {
    return null; // LLM unavailable — the caller surfaces a retryable notice
  }

  const verifiedAnswer = input.answerText?.trim() || suggestion.correctAnswer;
  const verify = await verifyQuestion({
    questionText: input.questionText,
    answer: verifiedAnswer,
    explanation: suggestion.explanation,
    canonicalSubcategory: input.canonicalSubcategory ?? null,
    broadCategory: input.broadCategory ?? null,
    dimensions: ['false_premise', 'extra_fact'],
  });

  return {
    suggestedAnswer: suggestion.correctAnswer,
    alternateAnswers: suggestion.alternateAnswers,
    explanation: suggestion.explanation,
    // verifyQuestion returns null on any fault (fail-open) — surface that as
    // 'unverifiable' so the reviewer knows the machine couldn't vouch for it.
    verdict: verify?.outcome ?? 'unverifiable',
    reason: verify?.reason ?? 'the verifier was unavailable — approve on your own judgment',
    usedWeb: verify?.usedWeb ?? false,
    verifiedAnswer,
  };
}
