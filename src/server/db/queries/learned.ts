import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';

import { categoryLabel } from '@/lib/questions-types';
import { db, masteryEvents, questions } from '@/server/db';

// One question you missed at first and later got right, shaped for the
// "Something you learned this week" ceremony.
export type LearnedItem = {
  questionId: string;
  questionText: string;
  correctAnswer: string;
  domain: string;
  domainDisplayName: string;
  learnedAt: string; // ISO timestamp of the corrected (now-right) answer
};

const LEARNED_WINDOW_DAYS = 7;

// "Wrong then right" is exactly answer_state = 'first_correct_after_wrong':
// computeAnswerState (src/server/answer-state.ts) only stamps that state when a
// correct answer lands AFTER one or more wrong attempts on the same
// user+question. We read it straight off masteryEvents rather than diffing the
// daily-queue slots, so the signal is the same whether the correction happened
// in daily, catchup, the feed, or a friend's question.
//
// Scope note: masteryEvents.questionId references the canonical questions table,
// so this naturally covers house- and friend-authored questions. Pure bot slots
// that never minted a canonical question row are out of scope — the corrected
// state only exists for questions with a stable id to attribute it to.
export async function getLearnedThisWeek(userId: string): Promise<LearnedItem[]> {
  const windowStart = new Date(Date.now() - LEARNED_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      questionId: questions.id,
      questionText: questions.questionText,
      answerText: questions.answerText,
      canonicalSubcategory: questions.canonicalSubcategory,
      broadCategory: questions.broadCategory,
      category: questions.category,
      deletedAt: questions.deletedAt,
      learnedAt: masteryEvents.createdAt,
    })
    .from(masteryEvents)
    .innerJoin(questions, eq(questions.id, masteryEvents.questionId))
    .where(
      and(
        eq(masteryEvents.userId, userId),
        eq(masteryEvents.answerState, 'first_correct_after_wrong'),
        isNotNull(masteryEvents.questionId),
        gte(masteryEvents.createdAt, windowStart),
      ),
    )
    .orderBy(desc(masteryEvents.createdAt));

  // One card per question, keeping the most recent correction (rows are already
  // newest-first). A question can flip wrong->right more than once across days.
  const seen = new Set<string>();
  const items: LearnedItem[] = [];
  for (const row of rows) {
    if (row.deletedAt) continue;
    if (seen.has(row.questionId)) continue;
    seen.add(row.questionId);
    const domain = row.canonicalSubcategory || row.broadCategory || row.category;
    if (!domain) continue;
    items.push({
      questionId: row.questionId,
      questionText: row.questionText,
      correctAnswer: row.answerText,
      domain,
      domainDisplayName: categoryLabel(domain),
      learnedAt: (row.learnedAt ?? new Date()).toISOString(),
    });
  }
  return items;
}
