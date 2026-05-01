import { inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { db, joshingGames, questions, users } from '@/server/db';
import { getFeedForUser } from '@/server/db/queries/feed';

export const dynamic = 'force-dynamic';

function displayName(name: string | null, fallback = 'A friend') {
  return name?.trim() || fallback;
}

function domainPill(question: typeof questions.$inferSelect | undefined) {
  return question?.canonicalSubcategory || question?.broadCategory || question?.category || 'General';
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const feed = await getFeedForUser(session.userId);
  const questionIds = feed.map((item) => item.questionId).filter((id): id is string => Boolean(id));
  const sourceUserIds = feed.map((item) => item.sourceUserId);
  const gameIds = feed.map((item) => item.joshingGameId).filter((id): id is string => Boolean(id));

  const [questionRows, sourceRows, gameRows] = await Promise.all([
    questionIds.length
      ? db.select().from(questions).where(inArray(questions.id, questionIds))
      : Promise.resolve([]),
    sourceUserIds.length
      ? db.select().from(users).where(inArray(users.id, sourceUserIds))
      : Promise.resolve([]),
    gameIds.length
      ? db.select().from(joshingGames).where(inArray(joshingGames.id, gameIds))
      : Promise.resolve([]),
  ]);

  const questionById = new Map(questionRows.map((question) => [question.id, question]));
  const userById = new Map(sourceRows.map((user) => [user.id, user]));
  const gameById = new Map(gameRows.map((game) => [game.id, game]));

  return NextResponse.json({
    items: feed.map((item) => {
      const question = item.questionId ? questionById.get(item.questionId) : undefined;
      const sourceUser = userById.get(item.sourceUserId);
      const sourceName = displayName(sourceUser?.displayName ?? null);
      const game = item.joshingGameId ? gameById.get(item.joshingGameId) : undefined;

      return {
        id: item.id,
        kind: item.sourceType === 'joshing_game' ? 'joshing_game' : 'question',
        question_id: item.questionId,
        joshing_game_id: item.joshingGameId,
        source_type: item.sourceType,
        source_user_id: item.sourceUserId,
        source_friend_display_name: sourceName,
        source_attribution: item.sourceType === 'direct_sent'
          ? `${sourceName} sent this to you`
          : item.sourceType === 'authored_shared'
            ? `${sourceName} wrote this`
            : item.sourceType === 'joshing_game'
              ? `${sourceName} sent you a Joshing Game`
              : `${sourceName} thumbed up`,
        source_event_at: item.sourceEventAt,
        state: item.state,
        is_pinned: item.isPinned,
        question_text: question?.questionText ?? null,
        explanation: question?.explainerBrief ?? question?.factualExplanation ?? null,
        domain_pill: domainPill(question),
        game_title: game?.title ?? null,
      };
    }),
  });
}
