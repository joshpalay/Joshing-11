import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { getSeededPlayQuestions } from '@/server/db/queries/lately';
import { gradeAnswer } from '@/server/grading';

export const dynamic = 'force-dynamic';

// Lately milestone click-through grading. Practice-only: it grades the friend's
// literal question and reveals the answer, but writes NOTHING (no mastery event,
// no score) — Stage 1 is read-derived and adds no write path.
const gradeSchema = z.object({
  questionId: z.string().trim().min(1),
  submittedAnswer: z.string().trim().min(1),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = gradeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', message: 'questionId and submittedAnswer are required' },
      { status: 400 },
    );
  }

  // Authorization is by construction: getSeededPlayQuestions only resolves
  // questions that appear in THIS viewer's milestones.
  const [question] = await getSeededPlayQuestions(session.userId, [parsed.data.questionId]);
  if (!question) {
    return NextResponse.json({ error: 'not_found', message: 'Question not available' }, { status: 404 });
  }

  const grade = await gradeAnswer(
    parsed.data.submittedAnswer,
    question.correctAnswer,
    question.acceptedAlternatives,
    question.questionText,
    question.questionType,
  );
  const isCorrect = grade.result === 'correct';

  return NextResponse.json({
    questionId: question.questionId,
    result: grade.result,
    isCorrect,
    correctAnswer: question.correctAnswer,
    explanation: question.explanation,
    consolation: grade.consolation,
  });
}
