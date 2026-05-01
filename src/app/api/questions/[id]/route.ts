import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { db, questions } from '@/server/db';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await context.params;
  const [question] = await db
    .select()
    .from(questions)
    .where(and(eq(questions.id, id), isNull(questions.deletedAt)))
    .limit(1);

  if (!question) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({
    id: question.id,
    question_text: question.questionText,
    answer_text: question.answerText,
    explanation: question.explainerFullWrong
      ?? question.explainerFull
      ?? question.explainerBriefWrong
      ?? question.explainerBrief
      ?? question.factualExplanation
      ?? null,
  });
}
