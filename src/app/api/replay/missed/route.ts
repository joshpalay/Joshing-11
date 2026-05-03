import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getReplayWrongQuestions } from '@/server/db/queries/replay';
import { selectReplaySession } from '@/server/replay/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const items = await getReplayWrongQuestions(session.userId);
  return NextResponse.json({
    items,
    session: selectReplaySession(items),
    total_wrong: items.length,
  });
}
