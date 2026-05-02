import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { createCreatorNote } from '@/server/creator-notes';

export const dynamic = 'force-dynamic';

function parseBody(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const questionId = typeof record.questionId === 'string' ? record.questionId.trim() : '';
  const recipientUserId = typeof record.recipientUserId === 'string' ? record.recipientUserId.trim() : '';
  const noteText = typeof record.noteText === 'string' ? record.noteText.trim() : '';
  if (!questionId || !recipientUserId || !noteText || noteText.length > 500) return null;
  return { questionId, recipientUserId, noteText };
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = parseBody(await request.json().catch(() => null));
  if (!parsed) {
    return NextResponse.json(
      { error: 'validation', message: 'questionId, recipientUserId, and a noteText up to 500 characters are required.' },
      { status: 400 },
    );
  }

  const result = await createCreatorNote({
    authorUserId: session.userId,
    questionId: parsed.questionId,
    recipientUserId: parsed.recipientUserId,
    noteText: parsed.noteText,
  });

  if ('error' in result) {
    const status = result.error === 'not_found' ? 404 : result.error === 'forbidden' ? 403 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ id: result.id }, { status: 201 });
}
