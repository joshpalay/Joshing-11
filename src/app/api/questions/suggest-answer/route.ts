import { NextRequest, NextResponse } from 'next/server';

import { suggestAnswer } from '@/lib/llm';
import { getSession } from '@/server/auth/session';

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { question?: unknown } | null;
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (question.length < 5)
    return NextResponse.json({ error: 'question too short' }, { status: 400 });

  return NextResponse.json(await suggestAnswer(question));
}
