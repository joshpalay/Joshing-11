import { and, desc, eq, gte, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';

import { db, masteryEvents, questions, users } from '@/server/db';

export type LatelyDirection = 'they_got_you' | 'you_got_them';

export type LatelyMoment = {
  momentId: string;
  dir: LatelyDirection;
  friendId: string;
  friendName: string;
  friendFirstName: string;
  questionId: string;
  questionText: string;
  category: string;
  gameTitle: string;
  answeredAt: Date;
};

const CATEGORY_ENUM_PRETTY: Record<string, string> = {
  music: 'music',
  literature: 'literature',
  history: 'history',
  film_tv: 'film & TV',
  sport: 'sport',
  science: 'science',
  philosophy: 'philosophy',
  pop_culture: 'pop culture',
  language: 'language',
  general_knowledge: 'general knowledge',
};

function prettifyCategory(canonical: string | null, coarse: string | null): string {
  const trimmed = canonical?.trim();
  if (trimmed) return trimmed;
  if (coarse && CATEGORY_ENUM_PRETTY[coarse]) return CATEGORY_ENUM_PRETTY[coarse];
  return 'something';
}

function firstName(displayName: string | null, fallback: string): string {
  const trimmed = displayName?.trim();
  if (!trimmed) return fallback;
  const head = trimmed.split(/\s+/)[0];
  return head || fallback;
}

// Lately surfaces "friend correctly answered your question" (they_got_you) and
// "you correctly answered friend's question" (you_got_them). Every answer in
// the app — daily, feed, catchup, joshing game, direct question — writes a
// masteryEvents row; the legacy JoshingGameResponses table only sees the
// joshing-game subset, so querying from there missed ~all events.
//
// sourceType IN ('live_correct', 'catchup_correct') gates by SURFACE (live
// vs catchup), not correctness — the naming is misleading. Correctness lives
// in answerState; 'incorrect' must be excluded so wrong answers don't render
// as "Robyn got you on …".
//
// masteryEvents.userId IS the answerer for these surface rows (only
// author_credit / curator_credit put a non-answerer there, and those source
// types are excluded by the sourceType filter).
const CORRECT_ANSWER_STATES = [
  'first_correct',
  'first_correct_after_wrong',
  'repeat_correct',
] as const;
const LIVE_SOURCE_TYPES = ['live_correct', 'catchup_correct'] as const;

export async function getLatelyMoments(userId: string): Promise<LatelyMoment[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const friendIdExpr = sql<string>`CASE WHEN ${questions.creatorId} = ${userId} THEN ${masteryEvents.userId} ELSE ${questions.creatorId} END`;

  const rows = await db
    .select({
      momentId: masteryEvents.id,
      creatorId: questions.creatorId,
      answererId: masteryEvents.userId,
      friendId: friendIdExpr,
      friendDisplayName: users.displayName,
      questionId: questions.id,
      questionText: questions.questionText,
      canonicalSubcategory: questions.canonicalSubcategory,
      category: questions.category,
      answeredAt: masteryEvents.createdAt,
    })
    .from(masteryEvents)
    .innerJoin(questions, eq(questions.id, masteryEvents.questionId))
    .innerJoin(users, eq(users.id, friendIdExpr))
    .where(
      and(
        inArray(masteryEvents.sourceType, LIVE_SOURCE_TYPES),
        inArray(masteryEvents.answerState, CORRECT_ANSWER_STATES),
        isNotNull(masteryEvents.questionId),
        gte(masteryEvents.createdAt, thirtyDaysAgo),
        or(
          and(eq(questions.creatorId, userId), ne(masteryEvents.userId, userId)),
          and(eq(masteryEvents.userId, userId), ne(questions.creatorId, userId)),
        ),
      ),
    )
    .orderBy(desc(masteryEvents.createdAt))
    .limit(200);

  const moments: LatelyMoment[] = [];
  for (const row of rows) {
    if (!row.answeredAt) continue;
    if (!row.friendId) continue;
    const dir: LatelyDirection =
      row.creatorId === userId ? 'they_got_you' : 'you_got_them';
    const friendName = row.friendDisplayName?.trim() || 'A friend';
    moments.push({
      momentId: row.momentId,
      dir,
      friendId: row.friendId,
      friendName,
      friendFirstName: firstName(row.friendDisplayName, friendName),
      questionId: row.questionId,
      questionText: row.questionText,
      category: prettifyCategory(row.canonicalSubcategory, row.category),
      // Footnote brand label. v2 spec example uses ASTERISK; not worth
      // per-surface disambiguation until the user asks for it.
      gameTitle: 'asterisk',
      answeredAt: row.answeredAt,
    });
  }
  return moments;
}
