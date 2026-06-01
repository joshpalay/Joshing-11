import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { checkBankedQuestions } from '@/server/db/queries/bank';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { questionIds?: unknown } | null;
  const questionIds = Array.isArray(body?.questionIds)
    ? body.questionIds.filter((id): id is string => typeof id === 'string')
    : [];

  return NextResponse.json(await checkBankedQuestions(session.userId, questionIds));
}
