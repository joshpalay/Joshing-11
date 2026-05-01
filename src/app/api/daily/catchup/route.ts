import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getCatchupQuestions } from '@/server/db/queries/daily';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const questions = await getCatchupQuestions(session.userId);
  return NextResponse.json({
    questions: questions.map((question) => ({
      dailyQueueItemId: question.dailyQueueItemId,
      queueDate: question.queueDate,
      slotIndex: question.slotIndex,
      questionId: question.questionId,
      questionText: question.questionText,
      domain: question.domain,
      skipped: question.skipped,
    })),
    count: questions.length,
  });
}
