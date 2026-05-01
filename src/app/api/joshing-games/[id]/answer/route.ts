import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { writeActivity } from '@/server/activity/write-activity';
import { getSession } from '@/server/auth/session';
import { db, feedItems, users } from '@/server/db';
import {
  checkJoshingGameCompletion,
  getJoshingGame,
  JoshingGameValidationError,
  submitJoshingGameResponse,
} from '@/server/db/queries/joshing-game';
import { sendSms } from '@/server/sms';

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
    const freshView = await getJoshingGame({ gameId: id, requestingUserId: session.userId });

    if (!freshView) return NextResponse.json({ error: 'not_found' }, { status: 404 });

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

    return NextResponse.json({
      ...grade,
      viewerStatus: freshView.viewerStatus,
    });
  } catch (error) {
    if (error instanceof JoshingGameValidationError) {
      const status = error.message === 'userId is not a recipient or creator of this game' ? 403 : error.status;
      return NextResponse.json({ error: 'validation', message: error.message }, { status });
    }
    throw error;
  }
}
