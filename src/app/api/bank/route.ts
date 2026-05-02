import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { addToBank, getBankedQuestions, removeFromBank, type BankContextType } from '@/server/db/queries/bank';

export const dynamic = 'force-dynamic';

function parseContextType(value: unknown): BankContextType | undefined {
  return value === 'feed' || value === 'joshing_game' || value === 'manual' ? value : undefined;
}

function parseQuestionId(body: Record<string, unknown> | null): string | null {
  return typeof body?.questionId === 'string' && body.questionId.trim() ? body.questionId.trim() : null;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  return NextResponse.json({ questions: await getBankedQuestions(session.userId) });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const questionId = parseQuestionId(body);
  if (!questionId) return NextResponse.json({ error: 'validation', message: 'questionId is required' }, { status: 400 });

  const result = await addToBank({
    userId: session.userId,
    questionId,
    contextType: parseContextType(body?.contextType),
    contextId: typeof body?.contextId === 'string' ? body.contextId : undefined,
  });

  if (!result.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const questionId = parseQuestionId(body);
  if (!questionId) return NextResponse.json({ error: 'validation', message: 'questionId is required' }, { status: 400 });

  await removeFromBank(session.userId, questionId);
  return NextResponse.json({ ok: true });
}
