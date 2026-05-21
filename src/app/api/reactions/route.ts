import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { isReactionKey, isWrongAnswerReactionKey, type ReactionKey } from '@/lib/reactions';
import { getSession } from '@/server/auth/session';
import { db, feedItems, joshingGameQuestions, joshingGameRecipients, joshingGames } from '@/server/db';
import {
  createReaction,
  getReactionsForUser,
  getUnrepliedReactionCount,
  type ReactionContextType,
} from '@/server/db/queries/reactions';

export const dynamic = 'force-dynamic';

type ReactionBody = {
  questionId: string;
  contextType: ReactionContextType;
  contextId: string | null;
  reactionType: ReactionKey;
  customMessage?: string | null;
  includeSubmittedAnswer: boolean;
};

function parseBody(value: unknown): ReactionBody | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const questionId = typeof record.questionId === 'string' ? record.questionId.trim() : '';
  const contextType = record.contextType === 'feed' || record.contextType === 'joshing_game'
    ? record.contextType
    : null;
  const contextId = typeof record.contextId === 'string' && record.contextId.trim()
    ? record.contextId.trim()
    : null;
  const reactionType = typeof record.reactionType === 'string' ? record.reactionType.trim() : '';
  const customMessage = typeof record.customMessage === 'string' ? record.customMessage.trim().slice(0, 160) : null;
  // §8.22: only wrong-answer reactions are eligible to attach submitted text.
  // For any other reactionType we coerce to false even if the client asks.
  const includeSubmittedAnswerRequested = record.includeSubmittedAnswer === true;
  const includeSubmittedAnswer = includeSubmittedAnswerRequested && isWrongAnswerReactionKey(reactionType);

  if (!questionId || !contextType || !isReactionKey(reactionType)) return null;

  return { questionId, contextType, contextId, reactionType, customMessage, includeSubmittedAnswer };
}

async function resolveRecipient(body: ReactionBody, senderUserId: string): Promise<string | null> {
  if (body.contextType === 'feed') {
    if (!body.contextId) return null;
    const [feedItem] = await db
      .select({
        sourceUserId: feedItems.sourceUserId,
        questionId: feedItems.questionId,
        recipientUserId: feedItems.recipientUserId,
      })
      .from(feedItems)
      .where(and(eq(feedItems.id, body.contextId), eq(feedItems.recipientUserId, senderUserId)))
      .limit(1);

    if (!feedItem || feedItem.questionId !== body.questionId) return null;
    return feedItem.sourceUserId;
  }

  if (!body.contextId) return null;
  const [game] = await db
    .select({ creatorId: joshingGames.creatorId })
    .from(joshingGames)
    .where(eq(joshingGames.id, body.contextId))
    .limit(1);
  if (!game) return null;

  const [recipient] = await db
    .select({ id: joshingGameRecipients.id })
    .from(joshingGameRecipients)
    .where(and(eq(joshingGameRecipients.gameId, body.contextId), eq(joshingGameRecipients.userId, senderUserId)))
    .limit(1);

  if (!recipient && game.creatorId !== senderUserId) return null;

  const [gameQuestion] = await db
    .select({ id: joshingGameQuestions.id })
    .from(joshingGameQuestions)
    .where(and(eq(joshingGameQuestions.gameId, body.contextId), eq(joshingGameQuestions.questionId, body.questionId)))
    .limit(1);
  if (!gameQuestion) return null;

  return game.creatorId;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = parseBody(await request.json().catch(() => null));
  if (!body) {
    return NextResponse.json({ error: 'validation', message: 'Invalid reaction payload.' }, { status: 400 });
  }

  const recipientUserId = await resolveRecipient(body, session.userId);
  if (!recipientUserId) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (recipientUserId === session.userId) {
    return NextResponse.json({ error: 'self_reaction', message: 'You cannot react to your own question.' }, { status: 400 });
  }

  const created = await createReaction({
    senderUserId: session.userId,
    recipientUserId,
    questionId: body.questionId,
    contextType: body.contextType,
    contextId: body.contextId,
    reactionType: body.reactionType,
    customMessage: body.customMessage,
    includeSubmittedAnswer: body.includeSubmittedAnswer,
  });

  return NextResponse.json(created, { status: 201 });
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [reactions, unreadCount] = await Promise.all([
    getReactionsForUser(session.userId),
    getUnrepliedReactionCount(session.userId),
  ]);

  return NextResponse.json({ reactions, unreadCount });
}
