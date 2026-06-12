/**
 * First-Game Recap (B-FirstGameRecap-1) — DB orchestration.
 *
 * Loads the signals the pure beat logic needs and assembles the recap view for
 * the first completed Joshing game. Returns null whenever the recap must not
 * fire: already seen, game unavailable, viewer has not completed this game, or
 * another completed game predates this one.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db, users } from '@/server/db';
import { getJoshingGame, type JoshingGameView } from '@/server/db/queries/joshing-game';
import {
  computeFirstGameRecapBeats,
  isFirstGameRecapEligible,
  type FirstGameRecapView,
} from '@/server/games/first-game-recap';

type CompletedGameRow = {
  game_id: string;
  completed_at: Date;
};

function domainFor(question: JoshingGameView['questions'][number]['question']) {
  return question.canonicalSubcategory || question.broadCategory || question.category || 'General';
}

async function getFirstCompletedGameId(userId: string): Promise<string | null> {
  const rows = await db.execute<CompletedGameRow>(sql`
    SELECT
      r."gameId" AS game_id,
      max(coalesce(r."answeredAt", r."createdAt")) AS completed_at
    FROM "JoshingGameResponse" r
    WHERE r."userId" = ${userId}
      AND r."answeredAt" IS NOT NULL
    GROUP BY r."gameId"
    HAVING count(DISTINCT r."questionId") >= (
      SELECT count(*)
      FROM "JoshingGameQuestion" q
      WHERE q."gameId" = r."gameId"
    )
    AND (
      SELECT count(*)
      FROM "JoshingGameQuestion" q
      WHERE q."gameId" = r."gameId"
    ) > 0
    ORDER BY completed_at ASC, r."gameId" ASC
    LIMIT 1
  `);
  const first = Array.isArray(rows) ? rows[0] : rows.rows?.[0];
  return first?.game_id ?? null;
}

/** Assemble the first-game recap for `userId` + `gameId`, or null. */
export async function getFirstGameRecap(params: {
  userId: string;
  gameId: string;
}): Promise<FirstGameRecapView | null> {
  const [user] = await db
    .select({
      displayName: users.displayName,
      seenAt: users.firstGameRecapSeenAt,
    })
    .from(users)
    .where(eq(users.id, params.userId))
    .limit(1);

  if (!user || user.seenAt != null) return null;

  const view = await getJoshingGame({
    gameId: params.gameId,
    requestingUserId: params.userId,
  });
  if (!view || view.viewerStatus !== 'complete') return null;

  const firstCompletedGameId = await getFirstCompletedGameId(params.userId);
  const isFirstCompletedGame = firstCompletedGameId === params.gameId;

  if (
    !isFirstGameRecapEligible({
      seenAt: user.seenAt,
      isCurrentGameComplete: view.viewerStatus === 'complete',
      isFirstCompletedGame,
    })
  ) {
    return null;
  }

  const responseByQuestionId = new Map(
    view.responses
      .filter((response) => response.userId === params.userId)
      .map((response) => [response.questionId, response]),
  );

  return computeFirstGameRecapBeats({
    displayName: user.displayName,
    gameTitle: view.game.title,
    questions: view.questions.map((gameQuestion) => {
      const response = responseByQuestionId.get(gameQuestion.questionId);
      return {
        domainDisplayName: domainFor(gameQuestion.question),
        isCorrect: Boolean(response?.isCorrect),
        isSkipped: !response,
      };
    }),
  });
}

/** Mark the first-game recap as seen. Idempotent. */
export async function markFirstGameRecapSeen(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ firstGameRecapSeenAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.firstGameRecapSeenAt)));
}
