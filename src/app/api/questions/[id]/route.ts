import { and, eq, isNull } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { broadCategoryDisplayName, normalizeBroadQuestionCategoryOrDefault, normalizeCanonicalSubcategory } from '@/lib/question-categorization';
import { categorizeQuestion } from '@/lib/llm';
import { getSession } from '@/server/auth/session';
import { assessQuestionDifficulty } from '@/server/questions/llm-difficulty';
import { textContainsAnswer } from '@/server/questions/self-answering';
import { db, questions } from '@/server/db';
import {
  deleteQuestion,
  getQuestion,
  updateQuestion,
} from '@/server/db/queries/questions';
import { resolveActiveIncorrectReportsForQuestion } from '@/server/db/queries/content-reports';

type RouteContext = {
  params: Promise<{ id: string }>;
};

function splitAlternates(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return undefined;
}

type PatchValues = {
  text?: string;
  correctAnswer?: string;
  alternateAnswers?: string[];
  explanation?: string;
  category?: string;
  broadCategory?: string | null;
  subcategory?: string;
  canonicalSubcategory?: string;
  difficulty?: number;
};

// Field order for the `fields` error array, preserved from the prior
// hand-rolled validator so clients keep highlighting fields in the same order.
const PATCH_FIELD_ORDER = ['text', 'correctAnswer', 'alternateAnswers', 'explanation'] as const;

// Only the fields actually present in the body are validated (partial update).
// `explanation` tolerates a non-string (coerced to '') to match the prior
// parser, which only ever flagged it for exceeding the length cap.
// `alternateAnswers` keeps its lenient split (non-strings dropped, trimmed,
// empties removed) via preprocess, and an absent value stays undefined so an
// unrelated edit never clears stored alternates.
const patchSchema = z.object({
  text: z.string().transform((s) => s.trim()).pipe(z.string().min(1).max(300)).optional(),
  correctAnswer: z.string().transform((s) => s.trim()).pipe(z.string().min(1).max(200)).optional(),
  alternateAnswers: z
    .preprocess((v) => (v === undefined ? undefined : splitAlternates(v) ?? []), z.array(z.string().max(200)).max(5))
    .optional(),
  explanation: z.string().catch('').transform((s) => s.trim()).pipe(z.string().max(500)).optional(),
});

function validatePatchPayload(body: Record<string, unknown> | null): { values: PatchValues; errors: string[] } {
  const parsed = patchSchema.safeParse(body ?? {});
  if (parsed.success) {
    return { values: { ...parsed.data }, errors: [] };
  }
  const errors = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))].sort(
    (a, b) =>
      PATCH_FIELD_ORDER.indexOf(a as (typeof PATCH_FIELD_ORDER)[number]) -
      PATCH_FIELD_ORDER.indexOf(b as (typeof PATCH_FIELD_ORDER)[number]),
  );
  return { values: {}, errors };
}

async function questionExistsForAnotherUser(questionId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ creatorId: questions.creatorId })
    .from(questions)
    .where(and(eq(questions.id, questionId), isNull(questions.deletedAt)))
    .limit(1);

  return Boolean(row && row.creatorId !== userId);
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await context.params;
  const question = await getQuestion(id, session.userId);
  if (!question) {
    if (await questionExistsForAnotherUser(id, session.userId)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ question });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await context.params;
  if (await questionExistsForAnotherUser(id, session.userId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const { values, errors } = validatePatchPayload(body);
  if (errors.length > 0) return NextResponse.json({ error: 'validation', fields: errors }, { status: 400 });

  const existing = await getQuestion(id, session.userId);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (existing.usedInGamesCount > 0) {
    return NextResponse.json({ error: 'Question has been used in a game and cannot be edited.' }, { status: 409 });
  }

  const effectiveText = values.text ?? existing.text;
  const effectiveAnswer = values.correctAnswer ?? existing.correctAnswer;
  const effectiveAlternates = values.alternateAnswers ?? existing.alternateAnswers ?? [];
  if (
    (values.text !== undefined || values.correctAnswer !== undefined || values.alternateAnswers !== undefined)
    && textContainsAnswer(effectiveText, effectiveAnswer, effectiveAlternates)
  ) {
    return NextResponse.json(
      {
        error: 'answer_in_question',
        message: 'Your question appears to contain its own answer. Rephrase the question so it does not reveal the answer.',
      },
      { status: 400 },
    );
  }

  const shouldRecategorize = values.text !== undefined || values.correctAnswer !== undefined;
  if (shouldRecategorize) {
    const categorization = await categorizeQuestion(effectiveText, effectiveAnswer, effectiveAlternates);
    const category = normalizeBroadQuestionCategoryOrDefault(categorization.broad_category);
    const canonicalSubcategory = normalizeCanonicalSubcategory(categorization.subcategory) || 'General Knowledge';
    if (textContainsAnswer(canonicalSubcategory, effectiveAnswer, effectiveAlternates)) {
      console.warn('[questions/patch] category leaks answer (saving anyway)', {
        subcategory: canonicalSubcategory,
        answer: effectiveAnswer,
      });
    }
    values.category = category;
    values.broadCategory = broadCategoryDisplayName(category);
    values.canonicalSubcategory = canonicalSubcategory;
    values.subcategory = canonicalSubcategory;
  }

  const shouldReassessDifficulty = values.text !== undefined
    || values.correctAnswer !== undefined
    || values.explanation !== undefined
    || values.category !== undefined
    || values.canonicalSubcategory !== undefined;

  if (shouldReassessDifficulty) {
    const difficultyAssessment = await assessQuestionDifficulty({
      questionText: values.text ?? existing.text,
      correctAnswer: values.correctAnswer ?? existing.correctAnswer,
      broadCategory: values.broadCategory ?? existing.broadCategory,
      canonicalSubcategory: values.canonicalSubcategory ?? existing.canonicalSubcategory ?? existing.domain,
      explanation: values.explanation ?? existing.explanation,
    });
    values.difficulty = difficultyAssessment.difficulty;
  }

  const result = await updateQuestion({ questionId: id, userId: session.userId, ...values });
  if (!result.ok && result.reason === 'in_use') {
    return NextResponse.json({ error: 'Question has been used in a game and cannot be edited.' }, { status: 409 });
  }
  if (!result.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // B-Report-4: fixing the answer key (or accepted alternatives) resolves any open
  // incorrect report on this question, which lifts B-Report-3 suppression. Scoped to
  // answer-key/alternatives edits — a pure text/explanation/category edit does not clear it.
  if (values.correctAnswer !== undefined || values.alternateAnswers !== undefined) {
    await resolveActiveIncorrectReportsForQuestion(id);
  }

  return NextResponse.json({ ok: true, question: await getQuestion(id, session.userId) });
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await context.params;
  if (await questionExistsForAnotherUser(id, session.userId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const result = await deleteQuestion({ questionId: id, userId: session.userId });
  if (!result.ok && result.reason === 'in_use') {
    return NextResponse.json({ error: 'Question has been used in a game and cannot be deleted.' }, { status: 409 });
  }
  if (!result.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
