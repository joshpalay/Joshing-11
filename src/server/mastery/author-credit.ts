/**
 * Shared author-credit helpers used by all answer surfaces (Feed, Daily, Joshing Game).
 * Extracted from joshing-game.ts to enable calling from Feed and Daily routes.
 */

import { and, count, eq } from 'drizzle-orm';

import { db, masteryEvents, questions } from '@/server/db';
import { creatorMasteryAwardForNthCorrect } from '@/server/mastery/scoring';
import { writeMasteryEvent } from '@/server/mastery/write-mastery-event';

/**
 * Count existing author_credit mastery events for a given question+author pair.
 * The windowed model uses this ordinal to determine the credit amount for the
 * next correct answerer.
 */
export async function countAuthorCreditEvents(questionId: string, authorId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(masteryEvents)
    .where(and(
      eq(masteryEvents.userId, authorId),
      eq(masteryEvents.questionId, questionId),
      eq(masteryEvents.sourceType, 'author_credit'),
    ));

  return row?.value ?? 0;
}

export type AuthorCreditContext = {
  isCorrect: boolean;
  creatorId: string | null;
  answererUserId: string;
  domain: string | null;
};

/**
 * The single gate for author/curator mastery accrual on a correct answer.
 * Author credit is awarded ONLY to a real human creator who is not the answerer.
 *
 * This is what keeps every non-human origin mastery-ineligible by construction:
 * D-3 house questions (creatorId null, source 'house_authored') and the LLM
 * origins (daily_generated / curated_sent, also creatorId null) all fail the
 * `creatorId !== null` check, so no `author_credit` mastery event is ever
 * written for them. Because the "written by me" archive (keyed on
 * `creatorId = me`) and the knowledge "recently expanding" saved-questions
 * signal (keyed on `author_credit` events) both derive from that, a house
 * question also produces no "written by me" entry and no knowledge-domain author
 * signal — there is no author to credit. (Invariant: D-3 §D / Verified fact #10.)
 */
export function isAuthorCreditEligible(
  ctx: AuthorCreditContext,
): ctx is AuthorCreditContext & { creatorId: string; domain: string } {
  return (
    ctx.isCorrect
    && ctx.creatorId !== null
    && ctx.creatorId !== ctx.answererUserId
    && ctx.domain !== null
    && ctx.domain !== ''
  );
}

type QuestionStats = {
  correctCount: number;
  askedCount: number;
  calibratedDifficulty: typeof questions.$inferSelect['calibratedDifficulty'];
  llmDifficulty: typeof questions.$inferSelect['llmDifficulty'];
};

export type AwardAuthorCreditParams = {
  creatorUserId: string;
  answererUserId: string;
  questionId: string;
  domain: string;
  sourceId: string;
  broadCategory?: string | null;
  /**
   * Pre-fetched stats from the canonical Question row. Pass when the caller
   * already has the row loaded (feed/[id]/answer, questions/[id]/answer);
   * omit to have the helper fetch them itself (daily/answer, catchup/answer,
   * which only have a generated_question id pre-persist).
   */
  questionStats?: QuestionStats;
  /** Short label for log lines, e.g. 'daily/answer'. */
  scope: string;
};

/**
 * Compute and persist the author-credit mastery event for a correct answer.
 *
 * Designed to be called via `void awardAuthorCredit(...)` from every answer
 * route — the caller's HTTP response should never wait on this. All errors
 * are swallowed and logged; the answerer's own mastery write is unaffected.
 *
 * Pattern A callers (daily/answer, daily/catchup/answer) only have the
 * canonical question id at this point, so the helper fetches the stats row
 * itself. Pattern B callers (feed/[id]/answer, questions/[id]/answer)
 * already have the row in memory and pass it via `questionStats` so we
 * don't re-fetch.
 */
export async function awardAuthorCredit(params: AwardAuthorCreditParams): Promise<void> {
  try {
    let stats = params.questionStats;
    if (!stats) {
      const [row] = await db
        .select({
          correctCount: questions.correctCount,
          askedCount: questions.askedCount,
          calibratedDifficulty: questions.calibratedDifficulty,
          llmDifficulty: questions.llmDifficulty,
        })
        .from(questions)
        .where(eq(questions.id, params.questionId))
        .limit(1);
      if (!row) return;
      stats = row;
    }

    const existingCredits = await countAuthorCreditEvents(params.questionId, params.creatorUserId);
    const authorAward = creatorMasteryAwardForNthCorrect(
      stats.correctCount,
      stats.askedCount,
      existingCredits + 1,
      stats.calibratedDifficulty ?? stats.llmDifficulty,
    );
    if (authorAward.awardedPoints <= 0) return;

    await writeMasteryEvent({
      userId: params.creatorUserId,
      questionId: params.questionId,
      domain: params.domain,
      pointsAwarded: authorAward.awardedPoints,
      sourceType: 'author_credit',
      sourceId: params.sourceId,
      broadCategory: params.broadCategory ?? undefined,
      eventQuestionId: params.questionId,
      basePoints: authorAward.basePoints,
      weight: authorAward.weight,
      answeredByUserId: params.answererUserId,
    });
  } catch (err) {
    console.warn(`[${params.scope}] author_credit failed`, err);
  }
}
