import { and, countDistinct, eq, getTableColumns, isNull, sql } from 'drizzle-orm';

import {
  db,
  joshingGameQuestions,
  joshingGameResponses,
  joshingGames,
  questions,
  userQuestionBank,
} from '@/server/db';
import { broadCategoryDisplayName } from '@/lib/question-categorization';
import { pgErrorCode } from '@/server/db/pg-error';

export type QuestionView = {
  id: string;
  text: string;
  correctAnswer: string;
  alternateAnswers: string[];
  explanation: string | null;
  domain: string;
  domainDisplayName: string;
  broadCategory: string | null;
  canonicalSubcategory: string | null;
  subcategory: string | null;
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

let ensureQuestionSurfacePriorityColumnPromise: Promise<void> | null = null;

function ensureQuestionSurfacePriorityColumn(): Promise<void> {
  ensureQuestionSurfacePriorityColumnPromise ??= db.execute(sql`
    ALTER TABLE "Question"
      ADD COLUMN IF NOT EXISTS "surface_priority_score" DOUBLE PRECISION NOT NULL DEFAULT 0
  `).then(() => undefined);
  return ensureQuestionSurfacePriorityColumnPromise;
}

const questionTableColumns = getTableColumns(questions);
const questionViewColumns = {
  id: questionTableColumns.id,
  creatorId: questionTableColumns.creatorId,
  generatedQuestionId: questionTableColumns.generatedQuestionId,
  source: questionTableColumns.source,
  sourceQuestionId: questionTableColumns.sourceQuestionId,
  sourceCreatorId: questionTableColumns.sourceCreatorId,
  questionText: questionTableColumns.questionText,
  breadcrumbContext: questionTableColumns.breadcrumbContext,
  answerText: questionTableColumns.answerText,
  factualExplanation: questionTableColumns.factualExplanation,
  acceptedAlternatives: questionTableColumns.acceptedAlternatives,
  answerSource: questionTableColumns.answerSource,
  questionType: questionTableColumns.questionType,
  minimumRequired: questionTableColumns.minimumRequired,
  category: questionTableColumns.category,
  broadCategory: questionTableColumns.broadCategory,
  subcategory: questionTableColumns.subcategory,
  canonicalSubcategory: questionTableColumns.canonicalSubcategory,
  categoryOverridden: questionTableColumns.categoryOverridden,
  creatorNote: questionTableColumns.creatorNote,
  difficultyEstimate: questionTableColumns.difficultyEstimate,
  llmDifficulty: questionTableColumns.llmDifficulty,
  calibratedDifficulty: questionTableColumns.calibratedDifficulty,
  correctRate: questionTableColumns.correctRate,
  explainerBrief: questionTableColumns.explainerBrief,
  explainerFull: questionTableColumns.explainerFull,
  explainerBriefCorrect: questionTableColumns.explainerBriefCorrect,
  explainerFullCorrect: questionTableColumns.explainerFullCorrect,
  explainerBriefWrong: questionTableColumns.explainerBriefWrong,
  explainerFullWrong: questionTableColumns.explainerFullWrong,
  explainerBriefExpired: questionTableColumns.explainerBriefExpired,
  explainerFullExpired: questionTableColumns.explainerFullExpired,
  shortLabel: questionTableColumns.shortLabel,
  status: questionTableColumns.status,
  visibility: questionTableColumns.visibility,
  publicStatus: questionTableColumns.publicStatus,
  publicEligibilityScore: questionTableColumns.publicEligibilityScore,
  publicEligibilityReason: questionTableColumns.publicEligibilityReason,
  sharedToFriendsFeed: questionTableColumns.sharedToFriendsFeed,
  askedCount: questionTableColumns.askedCount,
  correctCount: questionTableColumns.correctCount,
  createdAt: questionTableColumns.createdAt,
  updatedAt: questionTableColumns.updatedAt,
  deletedAt: questionTableColumns.deletedAt,
};

export const bankQuestionSelectColumns = questionViewColumns;

type QuestionViewRow = Omit<QuestionRow, 'verified' | 'llmSuggestedAnswer' | 'critiqueIterations' | 'surfacePriorityScore'>
  & Partial<Pick<QuestionRow, 'verified' | 'llmSuggestedAnswer' | 'critiqueIterations' | 'surfacePriorityScore'>>;

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

function explanationFor(row: QuestionViewRow): string | null {
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

export async function toQuestionView(row: QuestionViewRow): Promise<QuestionView> {
  const stats = await readQuestionStats(row.id);
  const domain = row.canonicalSubcategory ?? row.category;
  const createdAt = toIso(row.createdAt) ?? new Date().toISOString();
  const updatedAt = toIso(row.updatedAt) ?? createdAt;

  return {
    id: row.id,
    text: row.questionText,
    correctAnswer: row.answerText,
    alternateAnswers: row.acceptedAlternatives ?? [],
    explanation: explanationFor(row),
    domain,
    domainDisplayName: row.canonicalSubcategory ?? broadCategoryDisplayName(domain),
    broadCategory: row.broadCategory,
    canonicalSubcategory: row.canonicalSubcategory,
    subcategory: row.subcategory,
    difficulty: difficultyToNumber(row.calibratedDifficulty ?? row.llmDifficulty ?? row.difficultyEstimate),
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
    verified: row.verified ?? true,
    llmSuggestedAnswer: row.llmSuggestedAnswer ?? null,
    critiqueIterations: row.critiqueIterations ?? 0,
  };
}

export async function getQuestionsForUser(userId: string): Promise<QuestionView[]> {
  const { getBankedQuestions } = await import('@/server/db/queries/bank');
  return getBankedQuestions(userId);
}

export async function getQuestion(questionId: string, userId: string): Promise<QuestionView | null> {
  const [row] = await db
    .select(questionViewColumns)
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
  category: string;
  broadCategory: string | null;
  subcategory: string;
  canonicalSubcategory: string;
  domain?: string;
  difficulty: number;
  creatorNote?: string | null;
  verified: boolean;
  llmSuggestedAnswer?: string | null;
  critiqueIterations: number;
}): Promise<{ id: string }> {
  await ensureQuestionSurfacePriorityColumn();

  const difficulty = numberToDifficulty(params.difficulty);
  const baseValues = {
    creatorId: params.authorId,
    questionText: params.text,
    answerText: params.correctAnswer,
    acceptedAlternatives: params.alternateAnswers,
    factualExplanation: params.explanation,
    creatorNote: params.creatorNote ?? null,
    category: params.category as typeof questions.$inferInsert.category,
    broadCategory: params.broadCategory,
    subcategory: params.subcategory,
    canonicalSubcategory: params.canonicalSubcategory,
    categoryOverridden: false,
    difficultyEstimate: difficulty,
    llmDifficulty: difficulty,
    calibratedDifficulty: difficulty,
    answerSource: params.llmSuggestedAnswer ? (params.verified ? 'llm_suggested' : 'llm_edited') : 'creator_written',
    questionType: 'factual',
    visibility: 'public',
    status: params.verified ? 'verified' : 'unverified',
  } satisfies Partial<typeof questions.$inferInsert>;

  const createWithValues = async (values: typeof questions.$inferInsert) => {
    const [created] = await db
      .insert(questions)
      .values(values)
      .returning({ id: questions.id });
    return created;
  };

  const createWithLegacyColumns = async () => {
    const answerSource = params.llmSuggestedAnswer
      ? (params.verified ? 'llm_suggested' : 'llm_edited')
      : 'creator_written';
    const status = params.verified ? 'verified' : 'unverified';
    const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO "Question" (
        "creator_id",
        "question_text",
        "answer_text",
        "factual_explanation",
        "accepted_alternatives",
        "answer_source",
        "question_type",
        "category",
        "broad_category",
        "subcategory",
        "canonical_subcategory",
        "category_overridden",
        "creator_note",
        "difficulty_estimate",
        "llm_difficulty",
        "calibrated_difficulty",
        "status",
        "visibility"
      )
      VALUES (
        ${params.authorId},
        ${params.text},
        ${params.correctAnswer},
        ${params.explanation},
        ${params.alternateAnswers}::text[],
        ${answerSource}::"AnswerSource",
        'factual'::"QuestionType",
        ${params.category}::"Category",
        ${params.broadCategory},
        ${params.subcategory},
        ${params.canonicalSubcategory},
        false,
        ${params.creatorNote ?? null},
        ${difficulty}::"DifficultyEstimate",
        ${difficulty}::"DifficultyEstimate",
        ${difficulty}::"DifficultyEstimate",
        ${status}::"QuestionStatus",
        'public'::"QuestionVisibility"
      )
      RETURNING "id"
    `);
    const created = Array.isArray(rows) ? rows[0] : rows.rows?.[0];
    if (!created) throw new Error('Failed to create legacy-compatible question');
    return created;
  };

  let created: { id: string };
  try {
    created = await createWithValues({
      ...baseValues,
      verified: params.verified,
      llmSuggestedAnswer: params.llmSuggestedAnswer ?? null,
      critiqueIterations: params.critiqueIterations,
    } as typeof questions.$inferInsert);
  } catch (error) {
    if (pgErrorCode(error) !== '42703') throw error;
    console.warn('[questions/create] current question columns unavailable; retrying legacy-compatible question insert', {
      userId: params.authorId,
      category: params.category,
      canonicalSubcategory: params.canonicalSubcategory,
    });
    try {
      created = await createWithValues(baseValues as typeof questions.$inferInsert);
    } catch (fallbackError) {
      if (pgErrorCode(fallbackError) !== '42703') throw fallbackError;
      console.warn('[questions/create] drizzle insert still references unavailable columns; saving with raw legacy-compatible insert', {
        userId: params.authorId,
        category: params.category,
      canonicalSubcategory: params.canonicalSubcategory,
      });
      created = await createWithLegacyColumns();
    }
  }

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
  category?: string;
  broadCategory?: string | null;
  subcategory?: string;
  canonicalSubcategory?: string;
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
  if (params.category !== undefined) {
    values.category = params.category as typeof questions.$inferInsert.category;
    values.categoryOverridden = false;
  }
  if (params.broadCategory !== undefined) values.broadCategory = params.broadCategory;
  if (params.subcategory !== undefined) values.subcategory = params.subcategory;
  if (params.canonicalSubcategory !== undefined) values.canonicalSubcategory = params.canonicalSubcategory;
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
