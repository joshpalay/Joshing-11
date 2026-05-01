import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { db, questions, userQuestionBank, users } from '@/server/db';
import { createJoshingGame, JoshingGameValidationError } from '@/server/db/queries/joshing-game';
import { sendSms } from '@/server/sms';

export const dynamic = 'force-dynamic';

type CreateJoshingGameBody = {
  title: string;
  recipientIds: string[];
  questionIds: string[];
};

function getBaseUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (configured) return configured.replace(/\/$/, '');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto') ?? 'https';
  return host ? `${protocol}://${host}` : request.nextUrl.origin;
}

function parseBody(value: unknown): CreateJoshingGameBody | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  if (
    typeof record.title !== 'string'
    || !Array.isArray(record.recipientIds)
    || !Array.isArray(record.questionIds)
    || !record.recipientIds.every((id) => typeof id === 'string')
    || !record.questionIds.every((id) => typeof id === 'string')
  ) {
    return null;
  }

  return {
    title: record.title.trim(),
    recipientIds: record.recipientIds,
    questionIds: record.questionIds,
  };
}

function validateBody(body: CreateJoshingGameBody, creatorId: string): string | null {
  if (!body.title) return 'title is required';
  if (body.title.length > 60) return 'title must be 60 characters or fewer';
  if (body.recipientIds.length === 0) return 'recipientIds must contain at least one user';
  if (body.questionIds.length === 0 || body.questionIds.length > 5) {
    return 'questionIds must contain 1 to 5 questions';
  }
  if (body.recipientIds.some((id) => !id.trim()) || body.questionIds.some((id) => !id.trim())) {
    return 'recipientIds and questionIds must contain only non-empty strings';
  }
  if (body.recipientIds.includes(creatorId)) {
    return 'creator cannot be a recipient';
  }
  return null;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = parseBody(await request.json().catch(() => null));
  if (!parsed) {
    return NextResponse.json({ error: 'validation', message: 'Invalid request body' }, { status: 400 });
  }

  const validationError = validateBody(parsed, session.userId);
  if (validationError) {
    return NextResponse.json({ error: 'validation', message: validationError }, { status: 400 });
  }

  const uniqueRecipientIds = [...new Set(parsed.recipientIds)];
  const uniqueQuestionIds = [...new Set(parsed.questionIds)];

  const [creatorRows, recipientRows, allowedQuestionRows] = await Promise.all([
    db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1),
    db
      .select({ id: users.id, phoneNumber: users.phoneNumber, smsOptIn: users.smsOptIn })
      .from(users)
      .where(inArray(users.id, uniqueRecipientIds)),
    db
      .select({ id: questions.id })
      .from(questions)
      .leftJoin(
        userQuestionBank,
        and(
          eq(userQuestionBank.questionId, questions.id),
          eq(userQuestionBank.userId, session.userId),
        ),
      )
      .where(and(
        inArray(questions.id, uniqueQuestionIds),
        isNull(questions.deletedAt),
        or(eq(questions.creatorId, session.userId), isNotNull(userQuestionBank.id)),
      )),
  ]);

  if (recipientRows.length !== uniqueRecipientIds.length) {
    return NextResponse.json({ error: 'validation', message: 'All recipientIds must be valid users' }, { status: 400 });
  }

  const allowedQuestionIds = new Set(allowedQuestionRows.map((row) => row.id));
  if (allowedQuestionIds.size !== uniqueQuestionIds.length) {
    return NextResponse.json(
      { error: 'validation', message: 'All questionIds must be valid questions in your bank or authored by you' },
      { status: 400 },
    );
  }

  try {
    const created = await createJoshingGame({
      title: parsed.title,
      creatorId: session.userId,
      recipientIds: uniqueRecipientIds,
      questionIds: parsed.questionIds,
    });

    const creatorName = creatorRows[0]?.displayName?.trim() || 'A friend';
    const gameUrl = `${getBaseUrl(request)}/games/${created.id}`;
    await Promise.all(
      recipientRows.map((recipient) => {
        if (!recipient.phoneNumber || recipient.smsOptIn === 'opted_out') return Promise.resolve();
        return sendSms(
          recipient.phoneNumber,
          `${creatorName} sent you a Joshing Game: ${parsed.title}. Play it here: ${gameUrl}`,
          'joshing_game_received',
          recipient.id,
        );
      }),
    );

    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (error) {
    if (error instanceof JoshingGameValidationError) {
      return NextResponse.json({ error: 'validation', message: error.message }, { status: error.status });
    }
    throw error;
  }
}
