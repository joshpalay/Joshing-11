import { and, countDistinct, desc, eq, getTableColumns, inArray, isNull, sql } from 'drizzle-orm';

import {
  db,
  feedItems,
  joshingGameQuestions,
  joshingGameResponses,
  joshingGames,
  masteryEvents,
  questions,
  userQuestionBank,
} from '@/server/db';
import { broadCategoryDisplayName } from '@/lib/question-categorization';
import { pgErrorCode } from '@/server/db/pg-error';
import { embedAndResolveDuplicate } from '@/server/pool/dedup';

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
  answerers?: { names: string[]; total: number };
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
  insideJoke: questionTableColumns.insideJoke,
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

// The pool-substrate fields (B1) are not part of the rendered question view, so
// they are excluded here like the other non-view columns — partial selects
// (e.g. bankQuestionSelectColumns) need not fetch them.
type QuestionViewNonViewKey =
  | 'verified' | 'llmSuggestedAnswer' | 'critiqueIterations' | 'surfacePriorityScore'
  | 'trustTier' | 'perishable' | 'sourceRefs' | 'isDuplicate' | 'suppressedBy' | 'embedding';
type QuestionViewRow = Omit<QuestionRow, QuestionViewNonViewKey>
  & Partial<Pick<QuestionRow, QuestionViewNonViewKey>>;

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
  const [responseStats, feedStats, gameStats] = await Promise.all([
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
    // Answers submitted via "Send to friend" land in feedItems, not joshingGameResponses.
    // joshingGameId is null filters out feed items that mirror an already-counted game response.
    db
      .select({
        timesAnswered: sql<number>`count(*)`,
        timesCorrect: sql<number>`count(*) filter (where ${feedItems.answerResult} = 'correct')`,
      })
      .from(feedItems)
      .where(and(
        eq(feedItems.questionId, questionId),
        sql`${feedItems.answerResult} is not null`,
        isNull(feedItems.joshingGameId),
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

  const timesAnswered =
    Number(responseStats[0]?.timesAnswered ?? 0) + Number(feedStats[0]?.timesAnswered ?? 0);
  const timesCorrect =
    Number(responseStats[0]?.timesCorrect ?? 0) + Number(feedStats[0]?.timesCorrect ?? 0);
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
  return getBankedQuestions(userId, { onlyAuthored: true });
}

export async function hasUserAuthoredAnyQuestion(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.creatorId, userId), isNull(questions.deletedAt)))
    .limit(1);
  return rows.length > 0;
}

export type AuthoredQuestionPreview = {
  id: string;
  questionText: string;
  canonicalSubcategory: string | null;
  broadCategory: string | null;
  difficulty: 'accessible' | 'moderate' | 'specialist' | null;
  createdAt: string;
  viewerAnswered: { result: 'correct' | 'incorrect' } | null;
};

export async function getAuthoredQuestionsForUser(params: {
  userId: string;
  limit?: number;
  viewerUserId?: string;
  // The effective viewer relationship to the author, precomputed by the
  // caller (the profile page uses portrait.visibility). Defaults to
  // 'self' when viewerUserId matches userId, else 'stranger' — the most
  // conservative interpretation.
  viewer?: 'self' | 'friend' | 'stranger';
  // Whether the authored_questions section is visible to the effective
  // viewer per PROFILE_SECTION_VISIBILITY. If false, returns []. Defaults
  // to true so callers that don't yet thread the section gate still see
  // questions (subject to the per-question filter below).
  sectionVisible?: boolean;
}): Promise<AuthoredQuestionPreview[]> {
  const limit = Math.max(1, Math.min(params.limit ?? 25, 100));
  const viewer =
    params.viewer ??
    (params.viewerUserId === params.userId ? 'self' : 'stranger');

  // Section-level gate: when the section is hidden to the effective
  // viewer, render nothing regardless of per-question visibility.
  if (params.sectionVisible === false) return [];

  // Per-question filter: self sees everything; friends see public+friends;
  // strangers see only public.
  const whereClauses = [
    eq(questions.creatorId, params.userId),
    isNull(questions.deletedAt),
    eq(questions.source, 'authored'),
  ];
  if (viewer === 'stranger') {
    whereClauses.push(eq(questions.visibility, 'public'));
  } else if (viewer === 'friend') {
    whereClauses.push(inArray(questions.visibility, ['public', 'friends']));
  }

  const rows = await db
    .select({
      id: questions.id,
      questionText: questions.questionText,
      canonicalSubcategory: questions.canonicalSubcategory,
      broadCategory: questions.broadCategory,
      calibratedDifficulty: questions.calibratedDifficulty,
      llmDifficulty: questions.llmDifficulty,
      difficultyEstimate: questions.difficultyEstimate,
      createdAt: questions.createdAt,
    })
    .from(questions)
    .where(and(...whereClauses))
    .orderBy(desc(questions.createdAt))
    .limit(limit);

  const viewerStatus = new Map<string, { result: 'correct' | 'incorrect' }>();
  if (params.viewerUserId && rows.length > 0) {
    const ids = rows.map((row) => row.id);
    const events = await db
      .select({
        questionId: masteryEvents.questionId,
        answerState: masteryEvents.answerState,
      })
      .from(masteryEvents)
      .where(
        and(
          eq(masteryEvents.userId, params.viewerUserId),
          eq(masteryEvents.answeredByUserId, params.viewerUserId),
          inArray(masteryEvents.questionId, ids),
        ),
      );

    for (const event of events) {
      if (!event.questionId) continue;
      const isCorrect = event.answerState !== null && event.answerState !== 'incorrect';
      const existing = viewerStatus.get(event.questionId);
      if (isCorrect) {
        viewerStatus.set(event.questionId, { result: 'correct' });
      } else if (!existing) {
        viewerStatus.set(event.questionId, { result: 'incorrect' });
      }
    }
  }

  return rows.map((row) => ({
    id: row.id,
    questionText: row.questionText,
    canonicalSubcategory: row.canonicalSubcategory,
    broadCategory: row.broadCategory,
    difficulty:
      row.calibratedDifficulty ?? row.llmDifficulty ?? row.difficultyEstimate ?? null,
    createdAt: row.createdAt.toISOString(),
    viewerAnswered: viewerStatus.get(row.id) ?? null,
  }));
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
  insideJoke?: string | null;
  verified: boolean;
  llmSuggestedAnswer?: string | null;
  critiqueIterations: number;
  publicStatus?: 'not_scored' | 'eligible_pending' | 'rejected' | 'opted_out' | 'migrated';
  publicEligibilityScore?: number | null;
  publicEligibilityReason?: string | null;
  visibility?: 'public' | 'friends' | 'private';
}): Promise<{ id: string }> {
  await ensureQuestionSurfacePriorityColumn();

  const visibility = params.visibility ?? 'public';

  const difficulty = numberToDifficulty(params.difficulty);
  const baseValues = {
    creatorId: params.authorId,
    questionText: params.text,
    answerText: params.correctAnswer,
    acceptedAlternatives: params.alternateAnswers,
    factualExplanation: params.explanation,
    creatorNote: params.creatorNote ?? null,
    insideJoke: params.insideJoke ?? null,
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
    visibility,
    status: params.verified ? 'verified' : 'unverified',
    ...(params.publicStatus !== undefined ? { publicStatus: params.publicStatus } : {}),
    ...(params.publicEligibilityScore !== undefined ? { publicEligibilityScore: params.publicEligibilityScore } : {}),
    ...(params.publicEligibilityReason !== undefined ? { publicEligibilityReason: params.publicEligibilityReason } : {}),
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
        ${visibility}::"QuestionVisibility"
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

  // Semantic-dedup backstop (B1 pool substrate). Best-effort, no-op without a
  // VOYAGE_API_KEY. A human-authored question that collides with an existing
  // MACHINE pool row suppresses the *machine* row (human beats machine); a
  // collision with another human row suppresses this new one. Always flags,
  // never deletes.
  await embedAndResolveDuplicate({ id: created.id, origin: 'human', questionText: params.text });

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
