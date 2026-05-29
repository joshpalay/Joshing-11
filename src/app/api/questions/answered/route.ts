import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getArchiveForUser } from '@/server/db/queries/archive';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const archive = await getArchiveForUser({
    userId: session.userId,
    kind: 'answered',
    limit: 100,
  });

  const items = archive.items.map((item) => ({
    id: item.id,
    questionId: item.questionId,
    questionText: item.questionText,
    submittedAnswer: item.submittedAnswer,
    correctAnswer: item.correctAnswer,
    result: item.result,
    askerName: item.askerName,
    answeredAt: item.answeredAt,
    sourceLabel: item.sourceLabel,
  }));

  return NextResponse.json({ items, nextCursor: archive.nextCursor });
}
