import { and, desc, eq, gte } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { activityItems, db } from '@/server/db';
import { runDomainMergesForUser } from '@/server/mastery/ceremony';

export const dynamic = 'force-dynamic';

const TIDY_ACTIVITY_TYPE = 'knowledge_tidy';

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - 24);

  const [recentTidy] = await db
    .select({ id: activityItems.id, createdAt: activityItems.createdAt })
    .from(activityItems)
    .where(and(
      eq(activityItems.userId, session.userId),
      eq(activityItems.type, TIDY_ACTIVITY_TYPE),
      gte(activityItems.createdAt, cutoff),
    ))
    .orderBy(desc(activityItems.createdAt))
    .limit(1);

  if (recentTidy) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'You can tidy your map once every 24 hours.' },
      { status: 429 },
    );
  }

  const result = await runDomainMergesForUser(session.userId);

  await db.insert(activityItems).values({
    userId: session.userId,
    type: TIDY_ACTIVITY_TYPE,
    referenceId: result.mergesApplied > 0 ? result.details.map((detail) => detail.target).join(', ') : null,
    referenceType: 'knowledge_tidy',
  });

  return NextResponse.json(result);
}
