/**
 * Hearted-question protection for bulk bank-hygiene sweeps.
 *
 * A heart (QuestionFeedback signal='thumbs_up') is a human saying this
 * specific question was good. sweep-bank-quality's deterministic checks and
 * quality/off-domain gate are taste-and-filing judgments, not factual-
 * correctness checks — so a hearted row should never be silently swept away
 * by them; a human should look first. This is deliberately narrower than the
 * factual verification pipeline (verify-question.ts / the batch-verify cron):
 * a heart says nothing about whether a fact is TRUE, so it must never hold
 * back a factual demotion, only a taste/filing one.
 *
 * A heart can land on a bank row two ways: directly (QuestionFeedback.
 * generated_question_id, the path the daily recap actually uses today) or on
 * a canonical Question cloned from that bank row (QuestionFeedback.
 * question_id, joined back via Question.generated_question_id). Both are
 * checked so this doesn't silently miss hearts if the recap's target ever
 * changes.
 */

import { and, eq, inArray } from 'drizzle-orm';

import { db, questionFeedback, questions } from '@/server/db';

export async function getHeartedBankQuestionIds(
  bankQuestionIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(bankQuestionIds)];
  if (ids.length === 0) return new Set();

  const [direct, viaServedQuestion] = await Promise.all([
    db
      .select({ id: questionFeedback.generatedQuestionId })
      .from(questionFeedback)
      .where(
        and(
          eq(questionFeedback.signal, 'thumbs_up'),
          inArray(questionFeedback.generatedQuestionId, ids),
        ),
      ),
    db
      .select({ id: questions.generatedQuestionId })
      .from(questions)
      .innerJoin(questionFeedback, eq(questionFeedback.questionId, questions.id))
      .where(
        and(eq(questionFeedback.signal, 'thumbs_up'), inArray(questions.generatedQuestionId, ids)),
      ),
  ]);

  const hearted = new Set<string>();
  for (const row of direct) if (row.id) hearted.add(row.id);
  for (const row of viaServedQuestion) if (row.id) hearted.add(row.id);
  return hearted;
}
