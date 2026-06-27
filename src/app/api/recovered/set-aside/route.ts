import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import {
  restoreRecoveredQuestion,
  setAsideRecoveredQuestion,
} from '@/server/db/queries/recovered-questions';

/**
 * D-REVIEW-RECOVERED-01 — set a recovered-review question aside (POST) or
 * restore it (DELETE). A reversible per-user soft-dismiss that demotes the
 * question to the bottom of the viewer's recovered list; it writes only the
 * RecoveredSetAside row and touches nothing in the mastery system. Mirrors the
 * feed dismiss-domain route.
 */
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ questionId: z.string().min(1) });

function parseQuestionId(value: unknown): string | null {
  const parsed = bodySchema.safeParse(value);
  return parsed.success ? parsed.data.questionId : null;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const questionId = parseQuestionId(await request.json().catch(() => null));
  if (!questionId) {
    return NextResponse.json(
      { error: 'validation', message: 'questionId is required' },
      { status: 400 },
    );
  }

  await setAsideRecoveredQuestion(session.userId, questionId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const questionId = parseQuestionId(await request.json().catch(() => null));
  if (!questionId) {
    return NextResponse.json(
      { error: 'validation', message: 'questionId is required' },
      { status: 400 },
    );
  }

  await restoreRecoveredQuestion(session.userId, questionId);
  return NextResponse.json({ ok: true });
}
