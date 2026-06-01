import { and, eq } from 'drizzle-orm';
import { after, NextRequest, NextResponse } from 'next/server';

import { writeActivity } from '@/server/activity/write-activity';
import { getSession } from '@/server/auth/session';
import { db, feedItems, users } from '@/server/db';
import {
  checkJoshingGameCompletion,
  getJoshingGame,
  JoshingGameValidationError,
  submitJoshingGameResponse,
} from '@/server/db/queries/joshing-game';
import { createFeedItemsForFriendsFromAnswer } from '@/server/feed/create-feed-items-for-answer';
import { promoteDeclaredToDemonstrated } from '@/server/knowledge/open-domain';
import { sendSms } from '@/server/sms';
import { areFriends } from '@/server/db/queries/friends';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ id: string }>;
};

type AnswerBody = {
  questionId: string;
  submittedAnswer: string;
};

function getBaseUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (configured) return configured.replace(/\/$/, '');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto') ?? 'https';
  return host ? `${protocol}://${host}` : request.nextUrl.origin;
}

function parseBody(value: unknown): AnswerBody | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const questionId = typeof record.questionId === 'string' ? record.questionId.trim() : null;
  const submittedAnswer = typeof record.submittedAnswer === 'string' ? record.submittedAnswer.trim() : null;

  return questionId && submittedAnswer ? { questionId, submittedAnswer } : null;
}

async function getSmsUser(userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      phoneNumber: users.phoneNumber,
      smsOptIn: users.smsOptIn,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user ?? null;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await context.params;
  const parsed = parseBody(await request.json().catch(() => null));
  if (!parsed) {
    return NextResponse.json(
      { error: 'validation', message: 'questionId and submittedAnswer are required' },
      { status: 400 },
    );
  }

  const existingView = await getJoshingGame({ gameId: id, requestingUserId: session.userId });
  if (!existingView) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const isCreator = existingView.game.creatorId === session.userId;
  const isRecipient = existingView.recipients.some((recipient) => recipient.userId === session.userId);
  if (!isCreator && !isRecipient) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const beforeCompletion = await checkJoshingGameCompletion({ gameId: id, userId: session.userId });

  try {
    const grade = await submitJoshingGameResponse({
      gameId: id,
      questionId: parsed.questionId,
      userId: session.userId,
      submittedAnswer: parsed.submittedAnswer,
    });
    const completion = await checkJoshingGameCompletion({ gameId: id, userId: session.userId });

    const answeredQuestion = existingView.questions.find((item) => item.questionId === parsed.questionId);
    const correctAnswer = answeredQuestion?.question.answerText ?? '';
    const domain = answeredQuestion
      ? answeredQuestion.question.canonicalSubcategory || answeredQuestion.question.broadCategory || answeredQuestion.question.category
      : 'General Knowledge';

    if (grade.isCorrect && answeredQuestion?.question.creatorId && answeredQuestion.question.creatorId !== session.userId) {
      void promoteDeclaredToDemonstrated({
        userId: answeredQuestion.question.creatorId,
        domain,
        triggeringFriendId: session.userId,
        questionId: parsed.questionId,
      });
    }

    after(() => createFeedItemsForFriendsFromAnswer(
      session.userId,
      parsed.questionId,
      grade.isCorrect ? 'correct' : 'incorrect',
      `joshing_game:${id}:${parsed.questionId}:${session.userId}`,
    ));

    const newlyComplete = completion.userComplete && !beforeCompletion.userComplete;
    const creator = await getSmsUser(existingView.game.creatorId);
    const actor = await getSmsUser(session.userId);
    const baseUrl = getBaseUrl(request);

    if (newlyComplete && !completion.allComplete) {
      if (creator?.phoneNumber && creator.smsOptIn !== 'opted_out') {
        const actorName = actor?.displayName?.trim() || 'Someone';
        await sendSms(
          creator.phoneNumber,
          `${actorName} played ${existingView.game.title}. ${completion.completedUserIds.length} of ${existingView.recipients.length} have played. ${baseUrl}/games/${id}/summary`,
          'joshing_game_progress',
          creator.id,
        );
      }

      await writeActivity({
        userId: existingView.game.creatorId,
        type: 'joshing_game_progress',
        actorUserId: session.userId,
        referenceId: id,
        referenceType: 'joshing_game',
      });
    }

    if (completion.allComplete && !beforeCompletion.allComplete) {
      if (creator?.phoneNumber && creator.smsOptIn !== 'opted_out') {
        await sendSms(
          creator.phoneNumber,
          `Everyone played ${existingView.game.title}. See the full results. ${baseUrl}/games/${id}/summary`,
          'joshing_game_complete',
          creator.id,
        );
      }

      await db
        .update(feedItems)
        .set({ state: 'played' })
        .where(and(eq(feedItems.joshingGameId, id), eq(feedItems.sourceType, 'joshing_game')));

      await writeActivity({
        userId: existingView.game.creatorId,
        type: 'joshing_game_result',
        actorUserId: session.userId,
        referenceId: id,
        referenceType: 'joshing_game',
      });
    }

    const insideJoke = await selectInsideJokeForViewer(
      answeredQuestion?.question.insideJoke ?? null,
      answeredQuestion?.question.creatorId ?? null,
      session.userId,
    );

    return NextResponse.json({
      ...grade,
      correctAnswer,
      answerState: grade.answerState,
      breadcrumb: null,
      viewerStatus: completion.userComplete ? 'complete' : 'in_progress',
      insideJoke,
    });
  } catch (error) {
    if (error instanceof JoshingGameValidationError) {
      const status = error.message === 'userId is not a recipient or creator of this game' ? 403 : error.status;
      return NextResponse.json({ error: 'validation', message: error.message }, { status });
    }
    throw error;
  }
}

async function selectInsideJokeForViewer(
  insideJoke: string | null,
  creatorId: string | null,
  viewerId: string,
): Promise<string | null> {
  if (!insideJoke || !creatorId) return null;
  if (creatorId === viewerId) return insideJoke;
  const friends = await areFriends(viewerId, creatorId);
  return friends ? insideJoke : null;
}
