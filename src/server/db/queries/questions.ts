import { and, countDistinct, eq, isNull, sql } from 'drizzle-orm';

import {
  db,
  joshingGameQuestions,
  joshingGameResponses,
  joshingGames,
  questions,
  userQuestionBank,
} from '@/server/db';
import { categoryLabel } from '@/lib/questions-types';

export type QuestionView = {
  id: string;
  text: string;
  correctAnswer: string;
  alternateAnswers: string[];
  explanation: string | null;
  domain: string;
  domainDisplayName: string;
  difficulty: number;
  timesAnswered: number;
  timesCorrect: number;
  correctRate: number;
  createdAt: string;
  lastUsedAt: string | null;
  usedInGamesCount: number;
  question_text: string;
  answer_text: string;
  accepted_alternatives: string[];
  category: string;
  difficulty_estimate: 'accessible' | 'moderate' | 'specialist' | null;
  creator_id: string | null;
  created_at: string;
  updated_at: string;
  breadcrumb_context: string | null;
  short_label: string | null;
  answer_source: string | null;
  question_type: string;
  minimum_required: number | null;
  category_overridden: boolean;
  creator_note: string | null;
  visibility: string;
  tags: string[];
  asked_count: number;
  correct_count: number;
  isInBank?: boolean;
  isOwnAuthored?: boolean;
  authorName?: string;
  verified: boolean;
  llmSuggestedAnswer: string | null;
  critiqueIterations: number;
};

export type QuestionMutationResult = { ok: boolean; reason?: 'not_found' | 'in_use' };

type QuestionRow = typeof questions.$inferSelect;

function difficultyToNumber(value: QuestionRow['difficultyEstimate']): number {
  if (value === 'accessible') return 1;
  if (value === 'specialist') return 5;
  return 3;
}

function numberToDifficulty(value: number): 'accessible' | 'moderate' | 'specialist' {
  if (value <= 2) return 'accessible';
  if (value >= 4) return 'specialist';
  return 'moderate';
}

function explanationFor(row: QuestionRow): string | null {
  return row.factualExplanation
    ?? row.explainerFullWrong
    ?? row.explainerFull
    ?? row.explainerBriefWrong
    ?? row.explainerBrief
    ?? null;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function readQuestionStats(questionId: string) {
  const [responseStats, gameStats] = await Promise.all([
    db
      .select({
        timesAnswered: sql<number>`count(*)`,
        timesCorrect: sql<number>`count(*) filter (where ${joshingGameResponses.isCorrect} = true)`,
      })
      .from(joshingGameResponses)
      .where(and(
        eq(joshingGameResponses.questionId, questionId),
        sql`${joshingGameResponses.answeredAt} is not null`,
      )),
    db
      .select({
        lastUsedAt: sql<Date | null>`max(${joshingGames.createdAt})`,
        usedInGamesCount: countDistinct(joshingGameQuestions.gameId),
      })
      .from(joshingGameQuestions)
      .innerJoin(joshingGames, eq(joshingGameQuestions.gameId, joshingGames.id))
      .where(eq(joshingGameQuestions.questionId, questionId)),
  ]);

  const timesAnswered = Number(responseStats[0]?.timesAnswered ?? 0);
  const timesCorrect = Number(responseStats[0]?.timesCorrect ?? 0);
  const usedInGamesCount = Number(gameStats[0]?.usedInGamesCount ?? 0);

  return {
    timesAnswered,
    timesCorrect,
    correctRate: timesAnswered > 0 ? Math.round((timesCorrect / timesAnswered) * 100) : 0,
    lastUsedAt: toIso(gameStats[0]?.lastUsedAt ?? null),
    usedInGamesCount,
  };
}

export async function toQuestionView(row: QuestionRow): Promise<QuestionView> {
  const stats = await readQuestionStats(row.id);
  const domain = row.category;
  const createdAt = toIso(row.createdAt) ?? new Date().toISOString();
  const updatedAt = toIso(row.updatedAt) ?? createdAt;

  return {
    id: row.id,
    text: row.questionText,
    correctAnswer: row.answerText,
    alternateAnswers: row.acceptedAlternatives ?? [],
    explanation: explanationFor(row),
    domain,
    domainDisplayName: categoryLabel(domain),
    difficulty: difficultyToNumber(row.difficultyEstimate),
    timesAnswered: stats.timesAnswered,
    timesCorrect: stats.timesCorrect,
    correctRate: stats.correctRate,
    createdAt,
    lastUsedAt: stats.lastUsedAt,
    usedInGamesCount: stats.usedInGamesCount,
    question_text: row.questionText,
    answer_text: row.answerText,
    accepted_alternatives: row.acceptedAlternatives ?? [],
    category: row.category,
    difficulty_estimate: row.difficultyEstimate,
    creator_id: row.creatorId,
    created_at: createdAt,
    updated_at: updatedAt,
    breadcrumb_context: row.breadcrumbContext,
    short_label: row.shortLabel,
    answer_source: row.answerSource,
    question_type: row.questionType,
    minimum_required: row.minimumRequired,
    category_overridden: row.categoryOverridden,
    creator_note: row.creatorNote,
    visibility: row.visibility,
    tags: [],
    asked_count: row.askedCount,
    correct_count: row.correctCount,
    verified: row.verified,
    llmSuggestedAnswer: row.llmSuggestedAnswer,
    critiqueIterations: row.critiqueIterations,
  };
}

export async function getQuestionsForUser(userId: string): Promise<QuestionView[]> {
  const { getBankedQuestions } = await import('@/server/db/queries/bank');
  return getBankedQuestions(userId);
}

export async function getQuestion(questionId: string, userId: string): Promise<QuestionView | null> {
  const [row] = await db
    .select()
    .from(questions)
    .where(and(eq(questions.id, questionId), eq(questions.creatorId, userId), isNull(questions.deletedAt)))
    .limit(1);

  return row ? toQuestionView(row) : null;
}

export async function createQuestion(params: {
  authorId: string;
  text: string;
  correctAnswer: string;
  alternateAnswers: string[];
  explanation: string | null;
  domain: string;
  difficulty: number;
  creatorNote?: string | null;
  verified: boolean;
  llmSuggestedAnswer?: string | null;
  critiqueIterations: number;
}): Promise<{ id: string }> {
  const [created] = await db
    .insert(questions)
    .values({
      creatorId: params.authorId,
      questionText: params.text,
      answerText: params.correctAnswer,
      acceptedAlternatives: params.alternateAnswers,
      factualExplanation: params.explanation,
      creatorNote: params.creatorNote ?? null,
      category: params.domain as typeof questions.$inferInsert.category,
      categoryOverridden: true,
      difficultyEstimate: numberToDifficulty(params.difficulty),
      llmDifficulty: numberToDifficulty(params.difficulty),
      calibratedDifficulty: numberToDifficulty(params.difficulty),
      answerSource: params.llmSuggestedAnswer ? (params.verified ? 'llm_suggested' : 'llm_edited') : 'creator_written',
      questionType: 'factual',
      visibility: 'public',
      verified: params.verified,
      status: params.verified ? 'verified' : 'unverified',
      llmSuggestedAnswer: params.llmSuggestedAnswer ?? null,
      critiqueIterations: params.critiqueIterations,
    })
    .returning({ id: questions.id });

  await db
    .insert(userQuestionBank)
    .values({
      userId: params.authorId,
      questionId: created.id,
      addedFromContextType: 'manual',
    })
    .onConflictDoNothing({
      target: [userQuestionBank.userId, userQuestionBank.questionId],
    });

  return { id: created.id };
}

export async function updateQuestion(params: {
  questionId: string;
  userId: string;
  text?: string;
  correctAnswer?: string;
  alternateAnswers?: string[];
  explanation?: string;
  domain?: string;
  difficulty?: number;
}): Promise<QuestionMutationResult> {
  const existing = await getQuestion(params.questionId, params.userId);
  if (!existing) return { ok: false, reason: 'not_found' };
  if (existing.usedInGamesCount > 0) return { ok: false, reason: 'in_use' };

  const values: Partial<typeof questions.$inferInsert> = { updatedAt: new Date() };
  if (params.text !== undefined) values.questionText = params.text;
  if (params.correctAnswer !== undefined) values.answerText = params.correctAnswer;
  if (params.alternateAnswers !== undefined) values.acceptedAlternatives = params.alternateAnswers;
  if (params.explanation !== undefined) values.factualExplanation = params.explanation || null;
  if (params.domain !== undefined) {
    values.category = params.domain as typeof questions.$inferInsert.category;
    values.categoryOverridden = true;
  }
  if (params.difficulty !== undefined) {
    const difficulty = numberToDifficulty(params.difficulty);
    values.difficultyEstimate = difficulty;
    values.calibratedDifficulty = difficulty;
  }

  await db.update(questions).set(values).where(eq(questions.id, params.questionId));
  return { ok: true };
}

export async function deleteQuestion(params: {
  questionId: string;
  userId: string;
}): Promise<QuestionMutationResult> {
  const existing = await getQuestion(params.questionId, params.userId);
  if (!existing) return { ok: false, reason: 'not_found' };
  if (existing.usedInGamesCount > 0) return { ok: false, reason: 'in_use' };

  await db
    .update(questions)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(questions.id, params.questionId));

  return { ok: true };
}
