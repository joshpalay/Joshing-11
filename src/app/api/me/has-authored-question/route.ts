import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { hasUserAuthoredAnyQuestion } from '@/server/db/queries/questions';

export const dynamic = 'force-dynamic';

/**
 * Drives the §16.12 first-question orientation panel: returns whether the
 * current user has ever authored a non-deleted question. When `false`, the
 * panel is shown on the next QuestionForm mount.
 */
export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const hasAuthored = await hasUserAuthoredAnyQuestion(session.userId);
  return NextResponse.json({ hasAuthored });
}
