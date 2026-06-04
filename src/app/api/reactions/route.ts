import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

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

// Raw shape only; unrecognized types are coerced away (matching the prior
// hand-rolled parser). The business rules (trim, isReactionKey, the §8.22
// wrong-answer gate) are applied after parsing.
const bodySchema = z.object({
  questionId: z.string().optional().catch(undefined),
  contextType: z.enum(['feed', 'joshing_game']).optional().catch(undefined),
  contextId: z.string().optional().catch(undefined),
  reactionType: z.string().optional().catch(undefined),
  customMessage: z.string().optional().catch(undefined),
  includeSubmittedAnswer: z.boolean().optional().catch(undefined),
});

function parseBody(value: unknown): ReactionBody | null {
  const parsed = bodySchema.safeParse(value);
  if (!parsed.success) return null;
  const data = parsed.data;
  const questionId = typeof data.questionId === 'string' ? data.questionId.trim() : '';
  const contextType = data.contextType ?? null;
  const contextId = typeof data.contextId === 'string' && data.contextId.trim()
    ? data.contextId.trim()
    : null;
  const reactionType = typeof data.reactionType === 'string' ? data.reactionType.trim() : '';
  const customMessage = typeof data.customMessage === 'string' ? data.customMessage.trim().slice(0, 160) : null;
  // §8.22: only wrong-answer reactions are eligible to attach submitted text.
  // For any other reactionType we coerce to false even if the client asks.
  const includeSubmittedAnswerRequested = data.includeSubmittedAnswer === true;
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
