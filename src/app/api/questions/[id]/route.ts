import { and, eq, isNull } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

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

function validatePatchPayload(body: Record<string, unknown> | null) {
  const values: {
    text?: string;
    correctAnswer?: string;
    alternateAnswers?: string[];
    explanation?: string;
    category?: string;
    broadCategory?: string | null;
    subcategory?: string;
    canonicalSubcategory?: string;
    difficulty?: number;
  } = {};
  const errors: string[] = [];

  if (body?.text !== undefined) {
    values.text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!values.text || values.text.length > 300) errors.push('text');
  }
  if (body?.correctAnswer !== undefined) {
    values.correctAnswer = typeof body.correctAnswer === 'string' ? body.correctAnswer.trim() : '';
    if (!values.correctAnswer || values.correctAnswer.length > 200) errors.push('correctAnswer');
  }
  if (body?.alternateAnswers !== undefined) {
    values.alternateAnswers = splitAlternates(body.alternateAnswers) ?? [];
    if (values.alternateAnswers.length > 5 || values.alternateAnswers.some((answer) => answer.length > 200)) {
      errors.push('alternateAnswers');
    }
  }
  if (body?.explanation !== undefined) {
    values.explanation = typeof body.explanation === 'string' ? body.explanation.trim() : '';
    if (values.explanation.length > 500) errors.push('explanation');
  }
  return { values, errors };
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
    const categorization = await categorizeQuestion(effectiveText, effectiveAnswer);
    const category = normalizeBroadQuestionCategoryOrDefault(categorization.broad_category);
    const canonicalSubcategory = normalizeCanonicalSubcategory(categorization.subcategory) || 'General Knowledge';
    if (textContainsAnswer(canonicalSubcategory, effectiveAnswer, effectiveAlternates)) {
      console.warn('[questions/patch] rejected category that leaks answer', {
        subcategory: canonicalSubcategory,
        answer: effectiveAnswer,
      });
      return NextResponse.json(
        {
          error: 'category_leaks_answer',
          message:
            "This question's category would give away the answer. Try rephrasing the question so a different category fits.",
        },
        { status: 422 },
      );
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
