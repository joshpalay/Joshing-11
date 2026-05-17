import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getReplayWrongQuestions } from '@/server/db/queries/replay';
import { selectReplaySession } from '@/server/replay/session';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const excludeParam = request.nextUrl.searchParams.get('exclude');
  const excludeIds = excludeParam
    ? excludeParam.split(',').map((id) => id.trim()).filter(Boolean)
    : [];

  const items = await getReplayWrongQuestions(session.userId);
  const remaining = excludeIds.length > 0
    ? items.filter((item) => !excludeIds.includes(item.dailyQueueItemId))
    : items;
  return NextResponse.json({
    items: remaining,
    session: selectReplaySession(items, 5, excludeIds),
    total_wrong: remaining.length,
  });
}
