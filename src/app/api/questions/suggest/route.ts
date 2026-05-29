import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { suggestQuestionAnswer } from '@/server/llm/suggest-question';

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null) as { questionText?: unknown } | null;
  const questionText = typeof body?.questionText === 'string' ? body.questionText.trim() : '';
  if (!questionText) return NextResponse.json({ error: 'questionText is required' }, { status: 400 });

  try {
    const suggestion = await suggestQuestionAnswer(questionText);
    return NextResponse.json(suggestion);
  } catch {
    return NextResponse.json({ error: 'Suggestion unavailable.' }, { status: 500 });
  }
}
