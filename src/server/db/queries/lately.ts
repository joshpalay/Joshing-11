import { and, desc, eq, gte, ne, or, sql } from 'drizzle-orm';

import {
  db,
  joshingGameResponses,
  joshingGames,
  questions,
  users,
} from '@/server/db';

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
  gameId: string;
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

export async function getLatelyMoments(userId: string): Promise<LatelyMoment[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const friendIdExpr = sql<string>`CASE WHEN ${questions.creatorId} = ${userId} THEN ${joshingGameResponses.userId} ELSE ${questions.creatorId} END`;

  const rows = await db
    .select({
      momentId: joshingGameResponses.id,
      creatorId: questions.creatorId,
      responderId: joshingGameResponses.userId,
      friendId: friendIdExpr,
      friendDisplayName: users.displayName,
      questionId: questions.id,
      questionText: questions.questionText,
      canonicalSubcategory: questions.canonicalSubcategory,
      category: questions.category,
      gameId: joshingGames.id,
      gameTitle: joshingGames.title,
      answeredAt: joshingGameResponses.answeredAt,
    })
    .from(joshingGameResponses)
    .innerJoin(questions, eq(questions.id, joshingGameResponses.questionId))
    .innerJoin(joshingGames, eq(joshingGames.id, joshingGameResponses.gameId))
    .innerJoin(users, eq(users.id, friendIdExpr))
    .where(
      and(
        eq(joshingGameResponses.isCorrect, true),
        gte(joshingGameResponses.answeredAt, thirtyDaysAgo),
        or(
          and(eq(questions.creatorId, userId), ne(joshingGameResponses.userId, userId)),
          and(eq(joshingGameResponses.userId, userId), ne(questions.creatorId, userId)),
        ),
      ),
    )
    .orderBy(desc(joshingGameResponses.answeredAt))
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
      gameId: row.gameId,
      gameTitle: row.gameTitle,
      answeredAt: row.answeredAt,
    });
  }
  return moments;
}
