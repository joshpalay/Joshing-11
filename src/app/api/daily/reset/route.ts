import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { dailyQueues, db } from '@/server/db';
import { getDailyAssignmentBounds } from '@/lib/games/timezone';

export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await getSession();
  if (!session?.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { assignmentDateStr } = getDailyAssignmentBounds();
  await db
    .delete(dailyQueues)
    .where(
      and(eq(dailyQueues.userId, session.userId), eq(dailyQueues.queueDate, assignmentDateStr)),
    );

  return NextResponse.json({ ok: true });
}
