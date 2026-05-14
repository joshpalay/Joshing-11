import { and, asc, count, eq, sql } from 'drizzle-orm';

import { writeActivity } from '@/server/activity/write-activity';
import { getBasePoints, creatorMasteryAwardForNthCorrect } from '@/server/mastery/awards';
import { computeAnswerState } from '@/server/answer-state';
import { gradeAnswer } from '@/server/grading';
import { writeMasteryEvent } from '@/server/mastery/write-mastery-event';
import { promoteDeclaredToDemonstrated } from '@/server/knowledge/open-domain';
import type { QueueSlot } from '@/server/daily/types';
import type { AnswerState } from '@/types/db';
import {
  dailyQueues,
  db,
  feedItems,
  joshingGameQuestions,
  joshingGameRecipients,
  joshingGameResponses,
  joshingGames,
  masteryEvents,
  questions,
  users,
} from '@/server/db';

export type JoshingGameRow = typeof joshingGames.$inferSelect;
export type JoshingGameRecipientRow = typeof joshingGameRecipients.$inferSelect;
export type JoshingGameQuestionRow = typeof joshingGameQuestions.$inferSelect;
export type JoshingGameResponseRow = typeof joshingGameResponses.$inferSelect;
export type QuestionRow = typeof questions.$inferSelect;

export type JoshingGameQuestionView = JoshingGameQuestionRow & {
  question: QuestionRow;
};

export type JoshingGameView = {
  game: Pick<JoshingGameRow, 'id' | 'title' | 'creatorId' | 'createdAt'>;
  creator: { id: string; displayName: string };
  questions: JoshingGameQuestionView[];
  recipients: {
    userId: string;
    displayName: string;
    sentAt: Date;
    completedAt: Date | null;
    score: number | null;
  }[];
  responses: JoshingGameResponseRow[];
  viewerStatus: 'not_started' | 'in_progress' | 'complete';
};

type PriorAnswerResult = 'correct' | 'wrong' | 'expired';

export class JoshingGameValidationError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'JoshingGameValidationError';
  }
}

function assertValidCreateParams(params: {
  title: string;
  recipientIds: string[];
  questionIds: string[];
}) {
  if (!params.title.trim()) {
    throw new JoshingGameValidationError('title is required');
  }
  if (params.recipientIds.length === 0) {
    throw new JoshingGameValidationError('at least one recipient is required');
  }
  if (params.questionIds.length === 0 || params.questionIds.length > 5) {
    throw new JoshingGameValidationError('questionIds must contain 1 to 5 questions');
  }
}

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

function displayName(value: string | null, fallback = 'Unknown user'): string {
  return value?.trim() || fallback;
}

function questionDomain(question: QuestionRow): string {
  return question.canonicalSubcategory || question.broadCategory || question.category;
}

function questionExplanation(question: QuestionRow): string {
  return question.explainerFullCorrect
    ?? question.explainerFull
    ?? question.explainerBriefCorrect
    ?? question.explainerBrief
    ?? question.factualExplanation
    ?? '';
}

async function readPriorAnswers(userId: string, questionId: string): Promise<{ result: PriorAnswerResult }[]> {
  const joshingRows = await db
    .select({
      isCorrect: joshingGameResponses.isCorrect,
      answeredAt: joshingGameResponses.answeredAt,
      id: joshingGameResponses.id,
    })
    .from(joshingGameResponses)
    .where(and(eq(joshingGameResponses.userId, userId), eq(joshingGameResponses.questionId, questionId)))
    .orderBy(asc(joshingGameResponses.answeredAt), asc(joshingGameResponses.id));

  const dailyRows = await db
    .select({ slots: dailyQueues.slots, createdAt: dailyQueues.createdAt, id: dailyQueues.id })
    .from(dailyQueues)
    .where(eq(dailyQueues.userId, userId))
    .orderBy(asc(dailyQueues.createdAt), asc(dailyQueues.id));

  const dailyAnswers = dailyRows.flatMap((row) =>
    asQueueSlots(row.slots)
      .filter((slot) => slot.question_id === questionId && (slot.answered || slot.skipped))
      .map((slot) => ({
        result: slot.answer_state === 'correct' ? 'correct' as const : 'wrong' as const,
      })),
  );

  return [
    ...dailyAnswers,
    ...joshingRows.map((row) => ({
      result: row.isCorrect ? 'correct' as const : 'wrong' as const,
    })),
  ];
}

async function countAuthorCreditEvents(questionId: string, authorId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(masteryEvents)
    .where(and(
      eq(masteryEvents.userId, authorId),
      eq(masteryEvents.questionId, questionId),
      eq(masteryEvents.sourceType, 'author_credit'),
    ));

  return row?.value ?? 0;
}

export async function createJoshingGame(params: {
  title: string;
  creatorId: string;
  recipientIds: string[];
  questionIds: string[];
}): Promise<{ id: string }> {
  assertValidCreateParams(params);

  const uniqueRecipientIds = [...new Set(params.recipientIds)];
  const uniqueQuestionIds = [...new Set(params.questionIds)];
  if (uniqueQuestionIds.length !== params.questionIds.length) {
    throw new JoshingGameValidationError('questionIds must be unique');
  }

  const result = await db.transaction(async (tx) => {
    const [game] = await tx
      .insert(joshingGames)
      .values({
        title: params.title.trim(),
        creatorId: params.creatorId,
      })
      .returning({ id: joshingGames.id });

    if (!game) throw new Error('Failed to create Joshing Game');

    await tx.insert(joshingGameRecipients).values(
      uniqueRecipientIds.map((recipientId) => ({
        gameId: game.id,
        userId: recipientId,
      })),
    );

    await tx.insert(joshingGameQuestions).values(
      params.questionIds.map((questionId, index) => ({
        gameId: game.id,
        questionId,
        position: index + 1,
      })),
    );

    await tx.insert(feedItems).values(
      uniqueRecipientIds.map((recipientUserId) => ({
        recipientUserId,
        sourceType: 'joshing_game',
        isPinned: true,
        state: 'active',
        sourceUserId: params.creatorId,
        joshingGameId: game.id,
      })),
    );

    return { id: game.id };
  });

  await Promise.all(uniqueRecipientIds.map((userId) => writeActivity({
    userId,
    type: 'received_joshing_game',
    actorUserId: params.creatorId,
    referenceId: result.id,
    referenceType: 'joshing_game',
  })));

  return result;
}

export async function getJoshingGame(params: {
  gameId: string;
  requestingUserId: string;
}): Promise<JoshingGameView | null> {
  const [gameRow] = await db
    .select({
      game: joshingGames,
      creator: {
        id: users.id,
        displayName: users.displayName,
      },
    })
    .from(joshingGames)
    .innerJoin(users, eq(joshingGames.creatorId, users.id))
    .where(eq(joshingGames.id, params.gameId))
    .limit(1);

  if (!gameRow) return null;

  const [questionRows, recipientRows, responseRows] = await Promise.all([
    db
      .select({ gameQuestion: joshingGameQuestions, question: questions })
      .from(joshingGameQuestions)
      .innerJoin(questions, eq(joshingGameQuestions.questionId, questions.id))
      .where(eq(joshingGameQuestions.gameId, params.gameId))
      .orderBy(asc(joshingGameQuestions.position)),
    db
      .select({
        recipient: joshingGameRecipients,
        user: {
          id: users.id,
          displayName: users.displayName,
        },
      })
      .from(joshingGameRecipients)
      .innerJoin(users, eq(joshingGameRecipients.userId, users.id))
      .where(eq(joshingGameRecipients.gameId, params.gameId))
      .orderBy(asc(joshingGameRecipients.sentAt)),
    db
      .select()
      .from(joshingGameResponses)
      .where(eq(joshingGameResponses.gameId, params.gameId))
      .orderBy(asc(joshingGameResponses.createdAt)),
  ]);

  const questionCount = questionRows.length;
  const responsesByUser = new Map<string, JoshingGameResponseRow[]>();
  for (const response of responseRows) {
    const existing = responsesByUser.get(response.userId) ?? [];
    existing.push(response);
    responsesByUser.set(response.userId, existing);
  }

  const viewerResponses = responsesByUser.get(params.requestingUserId) ?? [];
  const viewerComplete = questionCount > 0 && viewerResponses.length >= questionCount;
  const viewerStatus = viewerResponses.length === 0
    ? 'not_started'
    : viewerComplete
      ? 'complete'
      : 'in_progress';

  const canSeeAllResponses = viewerComplete || params.requestingUserId === gameRow.game.creatorId;

  return {
    game: {
      id: gameRow.game.id,
      title: gameRow.game.title,
      creatorId: gameRow.game.creatorId,
      createdAt: gameRow.game.createdAt,
    },
    creator: {
      id: gameRow.creator.id,
      displayName: displayName(gameRow.creator.displayName),
    },
    questions: questionRows.map((row) => ({
      ...row.gameQuestion,
      question: row.question,
    })),
    recipients: recipientRows.map((row) => {
      const userResponses = responsesByUser.get(row.recipient.userId) ?? [];
      const completed = questionCount > 0 && userResponses.length >= questionCount;
      const completedAt = completed
        ? userResponses.reduce<Date | null>((latest, response) => {
            const answeredAt = response.answeredAt ?? response.createdAt;
            return !latest || answeredAt > latest ? answeredAt : latest;
          }, null)
        : null;

      return {
        userId: row.recipient.userId,
        displayName: displayName(row.user.displayName),
        sentAt: row.recipient.sentAt,
        completedAt,
        score: completed ? userResponses.filter((response) => response.isCorrect).length : null,
      };
    }),
    responses: canSeeAllResponses
      ? responseRows
      : responseRows.filter((response) => response.userId === params.requestingUserId),
    viewerStatus,
  };
}

export async function submitJoshingGameResponse(params: {
  gameId: string;
  questionId: string;
  userId: string;
  submittedAnswer: string;
}): Promise<{
  isCorrect: boolean;
  isPartial: boolean;
  explanation: string;
  pointsAwarded: number;
  answerState: AnswerState;
}> {
  const [game] = await db
    .select()
    .from(joshingGames)
    .where(eq(joshingGames.id, params.gameId))
    .limit(1);
  if (!game) throw new JoshingGameValidationError('gameId does not exist');

  const [membership] = await db
    .select({ id: joshingGameRecipients.id })
    .from(joshingGameRecipients)
    .where(and(
      eq(joshingGameRecipients.gameId, params.gameId),
      eq(joshingGameRecipients.userId, params.userId),
    ))
    .limit(1);
  if (!membership && game.creatorId !== params.userId) {
    throw new JoshingGameValidationError('userId is not a recipient or creator of this game');
  }

  const [gameQuestion] = await db
    .select({ gameQuestion: joshingGameQuestions, question: questions })
    .from(joshingGameQuestions)
    .innerJoin(questions, eq(joshingGameQuestions.questionId, questions.id))
    .where(and(
      eq(joshingGameQuestions.gameId, params.gameId),
      eq(joshingGameQuestions.questionId, params.questionId),
    ))
    .limit(1);
  if (!gameQuestion) {
    throw new JoshingGameValidationError('questionId is not in this game');
  }

  const [existingResponse] = await db
    .select({ id: joshingGameResponses.id })
    .from(joshingGameResponses)
    .where(and(
      eq(joshingGameResponses.gameId, params.gameId),
      eq(joshingGameResponses.questionId, params.questionId),
      eq(joshingGameResponses.userId, params.userId),
    ))
    .limit(1);
  if (existingResponse) {
    throw new JoshingGameValidationError('response already exists for this user and question');
  }

  const question = gameQuestion.question;
  const grade = await gradeAnswer(
    params.submittedAnswer,
    question.answerText,
    question.acceptedAlternatives,
    question.questionText,
    question.questionType,
  );
  const isCorrect = grade.result === 'correct';
  const isPartial = false;
  const priorAnswers = await readPriorAnswers(params.userId, params.questionId);
  const answerState = computeAnswerState(isCorrect ? 'correct' : 'wrong', priorAnswers);
  const basePoints = isCorrect
    ? getBasePoints(question.calibratedDifficulty ?? question.llmDifficulty ?? question.difficultyEstimate ?? null, answerState)
    : 0;
  const pointsAwarded = isCorrect ? basePoints : 0;
  const answeredAt = new Date();
  const domain = questionDomain(question);
  const explanation = questionExplanation(question);

  await db.transaction(async (tx) => {
    await tx.insert(joshingGameResponses).values({
      gameId: params.gameId,
      questionId: params.questionId,
      userId: params.userId,
      submittedAnswer: params.submittedAnswer,
      isCorrect,
      isPartial,
      answerState,
      pointsAwarded,
      answeredAt,
    });

    await tx
      .update(questions)
      .set({
        askedCount: sql`${questions.askedCount} + 1`,
        correctCount: isCorrect ? sql`${questions.correctCount} + 1` : questions.correctCount,
        updatedAt: answeredAt,
      })
      .where(eq(questions.id, params.questionId));
  });

  await writeMasteryEvent({
    userId: params.userId,
    questionId: params.questionId,
    domain,
    answerState,
    pointsAwarded,
    sourceType: 'joshing_game',
    sourceId: params.gameId,
    broadCategory: question.broadCategory,
    eventQuestionId: params.questionId,
    basePoints,
    weight: 1,
  });

  if (isCorrect && question.creatorId && question.creatorId !== params.userId) {
    const existingAuthorCredits = await countAuthorCreditEvents(params.questionId, question.creatorId);
    const authorAward = creatorMasteryAwardForNthCorrect(
      question.correctCount + 1,
      question.askedCount + 1,
      existingAuthorCredits + 1,
    );

    if (authorAward.awardedPoints > 0) {
      await writeMasteryEvent({
        userId: question.creatorId,
        questionId: params.questionId,
        domain,
        pointsAwarded: authorAward.awardedPoints,
        sourceType: 'author_credit',
        sourceId: params.gameId,
        broadCategory: question.broadCategory,
        eventQuestionId: params.questionId,
        basePoints: authorAward.basePoints,
        weight: authorAward.weight,
        answeredByUserId: params.userId,
      });
    }

    // Promote author's declared territory to demonstrated
    void promoteDeclaredToDemonstrated({
      userId: question.creatorId,
      domain,
      triggeringFriendId: params.userId,
      questionId: params.questionId,
    });
  }

  return {
    isCorrect,
    isPartial,
    explanation,
    pointsAwarded,
    answerState,
  };
}

export async function checkJoshingGameCompletion(params: {
  gameId: string;
  userId: string;
}): Promise<{
  userComplete: boolean;
  allComplete: boolean;
  completedUserIds: string[];
}> {
  const [questionCountRow] = await db
    .select({ value: count() })
    .from(joshingGameQuestions)
    .where(eq(joshingGameQuestions.gameId, params.gameId));
  const questionCount = questionCountRow?.value ?? 0;

  const [recipients, responses] = await Promise.all([
    db
      .select({ userId: joshingGameRecipients.userId })
      .from(joshingGameRecipients)
      .where(eq(joshingGameRecipients.gameId, params.gameId)),
    db
      .select({ userId: joshingGameResponses.userId, questionId: joshingGameResponses.questionId })
      .from(joshingGameResponses)
      .where(eq(joshingGameResponses.gameId, params.gameId)),
  ]);

  const answeredByUser = new Map<string, Set<string>>();
  for (const response of responses) {
    const set = answeredByUser.get(response.userId) ?? new Set<string>();
    set.add(response.questionId);
    answeredByUser.set(response.userId, set);
  }

  const completedUserIds = recipients
    .filter((recipient) => questionCount > 0 && (answeredByUser.get(recipient.userId)?.size ?? 0) >= questionCount)
    .map((recipient) => recipient.userId);

  return {
    userComplete: questionCount > 0 && (answeredByUser.get(params.userId)?.size ?? 0) >= questionCount,
    allComplete: recipients.length > 0 && completedUserIds.length === recipients.length,
    completedUserIds,
  };
}

export async function getAllUsers(): Promise<{ id: string; displayName: string; phone: string }[]> {
  // TODO Phase 8: replace with getFriends() when friend system is built.
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      phone: users.phoneNumber,
    })
    .from(users)
    .orderBy(asc(users.displayName), asc(users.phoneNumber));

  return rows.map((row) => ({
    id: row.id,
    displayName: displayName(row.displayName, row.phone),
    phone: row.phone,
  }));
}
