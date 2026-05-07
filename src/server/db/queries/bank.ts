import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import { writeActivity } from '@/server/activity/write-activity';
import { db, questions, userQuestionBank, users } from '@/server/db';
import { writeMasteryEvent } from '@/server/mastery/write-mastery-event';
import { type QuestionView, toQuestionView } from '@/server/db/queries/questions';

export type BankContextType = 'feed' | 'joshing_game' | 'manual';

export type BankedQuestion = QuestionView & {
  bankEntryId: string;
  bankedAt: string;
  isInBank: true;
  isOwnAuthored: boolean;
  authorName: string;
};

function questionDomain(question: typeof questions.$inferSelect): string {
  return question.canonicalSubcategory || question.broadCategory || question.category;
}

function displayName(value: string | null): string {
  return value?.trim() || 'A friend';
}

export async function addToBank(params: {
  userId: string;
  questionId: string;
  contextType?: BankContextType;
  contextId?: string;
}): Promise<{ ok: boolean; alreadyInBank?: boolean }> {
  const [question] = await db
    .select()
    .from(questions)
    .where(and(eq(questions.id, params.questionId), isNull(questions.deletedAt)))
    .limit(1);

  if (!question) return { ok: false };

  const inserted = await db
    .insert(userQuestionBank)
    .values({
      userId: params.userId,
      questionId: params.questionId,
      addedFromContextType: params.contextType,
      addedFromContextId: params.contextId,
    })
    .onConflictDoNothing({
      target: [userQuestionBank.userId, userQuestionBank.questionId],
    })
    .returning({ id: userQuestionBank.id });

  if (inserted.length === 0) return { ok: true, alreadyInBank: true };

  await db
    .update(questions)
    .set({ sharedToFriendsFeed: true, updatedAt: new Date() })
    .where(eq(questions.id, params.questionId));

  if (question.creatorId && question.creatorId !== params.userId) {
    const domain = questionDomain(question);
    await Promise.all([
      writeMasteryEvent({
        userId: question.creatorId,
        questionId: params.questionId,
        domain,
        pointsAwarded: 0.5,
        sourceType: 'curator_credit',
        sourceId: params.contextId ?? inserted[0].id,
        broadCategory: question.broadCategory,
        eventQuestionId: params.questionId,
        basePoints: 1,
        weight: 0.5,
        answeredByUserId: params.userId,
      }).catch((error) => console.error('Curator credit failed', error)),
      writeActivity({
        userId: question.creatorId,
        type: 'question_curated',
        actorUserId: params.userId,
        referenceId: params.questionId,
        referenceType: 'question',
      }),
    ]);
  }

  return { ok: true };
}

export async function removeFromBank(userId: string, questionId: string): Promise<void> {
  await db
    .delete(userQuestionBank)
    .where(and(eq(userQuestionBank.userId, userId), eq(userQuestionBank.questionId, questionId)));
}

export async function isInBank(userId: string, questionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: userQuestionBank.id })
    .from(userQuestionBank)
    .where(and(eq(userQuestionBank.userId, userId), eq(userQuestionBank.questionId, questionId)))
    .limit(1);

  return Boolean(row);
}

export async function checkBankedQuestions(userId: string, questionIds: string[]): Promise<Record<string, boolean>> {
  const uniqueIds = [...new Set(questionIds)].filter(Boolean);
  if (uniqueIds.length === 0) return {};

  const rows = await db
    .select({ questionId: userQuestionBank.questionId })
    .from(userQuestionBank)
    .where(and(eq(userQuestionBank.userId, userId), inArray(userQuestionBank.questionId, uniqueIds)));

  const banked = new Set(rows.map((row) => row.questionId));
  return Object.fromEntries(uniqueIds.map((id) => [id, banked.has(id)]));
}

export async function getBankedQuestions(userId: string): Promise<BankedQuestion[]> {
  const rows = await db
    .select({
      bank: userQuestionBank,
      question: questions,
      author: {
        id: users.id,
        displayName: users.displayName,
      },
    })
    .from(userQuestionBank)
    .innerJoin(questions, eq(userQuestionBank.questionId, questions.id))
    .innerJoin(users, eq(questions.creatorId, users.id))
    .where(and(eq(userQuestionBank.userId, userId), isNull(questions.deletedAt)))
    .orderBy(desc(userQuestionBank.addedAt));

  return Promise.all(rows.map(async (row) => {
    const view = await toQuestionView(row.question);
    return {
      ...view,
      bankEntryId: row.bank.id,
      bankedAt: row.bank.addedAt.toISOString(),
      isInBank: true,
      isOwnAuthored: row.question.creatorId === userId,
      authorName: row.question.creatorId === userId ? 'You' : displayName(row.author.displayName),
    };
  }));
}
