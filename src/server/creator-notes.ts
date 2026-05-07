import { and, count, desc, eq, gte, inArray, isNotNull, isNull } from 'drizzle-orm';

import { writeActivity } from '@/server/activity/write-activity';
import {
  creatorNotes,
  db,
  feedItems,
  joshingGameResponses,
  masteryEvents,
  questions,
  smsLogs,
  users,
} from '@/server/db';
import { sendSms } from '@/server/sms';

type ContextType = 'feed' | 'joshing_game' | 'daily';

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

function displayName(value: string | null | undefined, fallback = 'Someone') {
  return value?.trim() || fallback;
}

function truncateQuestion(value: string) {
  return value.length > 60 ? `${value.slice(0, 57)}...` : value;
}

export async function promptCreatorNoteAfterWrongAnswer(params: {
  questionId: string;
  recipientUserId: string;
  contextType: ContextType;
  contextId?: string | null;
}) {
  try {
    const [row] = await db
      .select({
        questionId: questions.id,
        questionText: questions.questionText,
        authorUserId: questions.creatorId,
        authorPhoneNumber: users.phoneNumber,
        authorSmsOptIn: users.smsOptIn,
      })
      .from(questions)
      .innerJoin(users, eq(questions.creatorId, users.id))
      .where(eq(questions.id, params.questionId))
      .limit(1);

    if (!row?.authorUserId || row.authorUserId === params.recipientUserId) return;
    if (!row.authorPhoneNumber || row.authorSmsOptIn === 'opted_out') return;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [recent] = await db
      .select({ value: count() })
      .from(smsLogs)
      .where(and(
        eq(smsLogs.userId, row.authorUserId),
        eq(smsLogs.messageType, 'creator_note_prompt'),
        gte(smsLogs.sentAt, since),
      ));

    if ((recent?.value ?? 0) >= 3) return;

    const [recipient] = await db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, params.recipientUserId))
      .limit(1);

    const url = `${appUrl()}/creator-notes/new?q=${encodeURIComponent(row.questionId)}&r=${encodeURIComponent(params.recipientUserId)}`;
    const body = `${displayName(recipient?.displayName)} just missed your question: '${truncateQuestion(row.questionText)}' Want to send them a note? ${url}`;

    await sendSms(row.authorPhoneNumber, body, 'creator_note_prompt', row.authorUserId);
  } catch (error) {
    console.error('creator_note_prompt failed', error);
  }
}

export async function findWrongAnswerContext(questionId: string, recipientUserId: string) {
  const [gameResponse] = await db
    .select({
      contextId: joshingGameResponses.gameId,
      submittedAnswer: joshingGameResponses.submittedAnswer,
      answeredAt: joshingGameResponses.answeredAt,
    })
    .from(joshingGameResponses)
    .where(and(
      eq(joshingGameResponses.questionId, questionId),
      eq(joshingGameResponses.userId, recipientUserId),
      eq(joshingGameResponses.isCorrect, false),
    ))
    .orderBy(desc(joshingGameResponses.answeredAt))
    .limit(1);

  if (gameResponse) {
    return {
      contextType: 'joshing_game' as const,
      contextId: gameResponse.contextId,
      submittedAnswer: gameResponse.submittedAnswer,
    };
  }

  const [feedItem] = await db
    .select({
      id: feedItems.id,
      submittedAnswer: feedItems.submittedAnswer,
    })
    .from(feedItems)
    .where(and(
      eq(feedItems.questionId, questionId),
      eq(feedItems.recipientUserId, recipientUserId),
      eq(feedItems.state, 'answered'),
    ))
    .limit(1);

  if (!feedItem) return null;

  const [correctEvent] = await db
    .select({ id: masteryEvents.id })
    .from(masteryEvents)
    .where(and(
      eq(masteryEvents.userId, recipientUserId),
      eq(masteryEvents.questionId, questionId),
      eq(masteryEvents.answeredByUserId, recipientUserId),
      eq(masteryEvents.sessionContext, 'feed'),
      inArray(masteryEvents.answerState, ['first_correct', 'first_correct_after_wrong', 'repeat_correct']),
    ))
    .limit(1);

  if (correctEvent) return null;
  return { contextType: 'feed' as const, contextId: feedItem.id, submittedAnswer: feedItem.submittedAnswer };
}

export async function createCreatorNote(params: {
  authorUserId: string;
  questionId: string;
  recipientUserId: string;
  noteText: string;
}) {
  const [question] = await db
    .select({ id: questions.id, creatorId: questions.creatorId })
    .from(questions)
    .where(eq(questions.id, params.questionId))
    .limit(1);

  if (!question) return { error: 'not_found' as const };
  if (question.creatorId !== params.authorUserId) return { error: 'forbidden' as const };

  const wrongAnswer = await findWrongAnswerContext(params.questionId, params.recipientUserId);
  if (!wrongAnswer) return { error: 'no_wrong_answer' as const };

  const now = new Date();
  const [note] = await db.insert(creatorNotes).values({
    authorUserId: params.authorUserId,
    recipientUserId: params.recipientUserId,
    questionId: params.questionId,
    contextType: wrongAnswer.contextType,
    contextId: wrongAnswer.contextId,
    noteText: params.noteText,
    promptedAt: now,
    writtenAt: now,
  }).returning({ id: creatorNotes.id });

  if (!note) throw new Error('Failed to create creator note');

  await writeActivity({
    userId: params.recipientUserId,
    type: 'creator_note_received',
    actorUserId: params.authorUserId,
    referenceId: note.id,
    referenceType: 'creator_note',
  });

  const [recipient] = await db
    .select({ phoneNumber: users.phoneNumber, smsOptIn: users.smsOptIn })
    .from(users)
    .where(eq(users.id, params.recipientUserId))
    .limit(1);
  const [author] = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, params.authorUserId))
    .limit(1);

  if (recipient?.phoneNumber && recipient.smsOptIn !== 'opted_out') {
    await sendSms(
      recipient.phoneNumber,
      `${displayName(author?.displayName)} sent you a note about a question you missed. ${appUrl()}/activities`,
      'creator_note_received',
      params.recipientUserId,
    );
  }

  return { id: note.id };
}

export async function markCreatorNoteDelivered(noteId: string, recipientUserId: string) {
  await db
    .update(creatorNotes)
    .set({ deliveredAt: new Date() })
    .where(and(
      eq(creatorNotes.id, noteId),
      eq(creatorNotes.recipientUserId, recipientUserId),
      isNull(creatorNotes.deliveredAt),
    ));
}

export type DeliveredCreatorNote = {
  questionId: string;
  authorName: string;
  noteText: string;
};

export async function getDeliveredCreatorNotesForQuestions(
  recipientUserId: string,
  questionIds: string[],
): Promise<Map<string, DeliveredCreatorNote>> {
  const ids = [...new Set(questionIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const rows = await db
    .select({
      questionId: creatorNotes.questionId,
      noteText: creatorNotes.noteText,
      authorName: users.displayName,
    })
    .from(creatorNotes)
    .innerJoin(users, eq(creatorNotes.authorUserId, users.id))
    .where(and(
      eq(creatorNotes.recipientUserId, recipientUserId),
      inArray(creatorNotes.questionId, ids),
      isNotNull(creatorNotes.deliveredAt),
    ))
    .orderBy(desc(creatorNotes.writtenAt));

  const byQuestion = new Map<string, DeliveredCreatorNote>();
  for (const row of rows) {
    if (byQuestion.has(row.questionId)) continue;
    byQuestion.set(row.questionId, {
      questionId: row.questionId,
      authorName: displayName(row.authorName, 'A friend'),
      noteText: row.noteText,
    });
  }
  return byQuestion;
}
