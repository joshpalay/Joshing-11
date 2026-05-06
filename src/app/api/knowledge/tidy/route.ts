import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { activityItems, db } from '@/server/db';
import { runDomainMergesForUser } from '@/server/mastery/ceremony';

export const dynamic = 'force-dynamic';

const TIDY_ACTIVITY_TYPE = 'knowledge_tidy';

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let result;
  try {
    result = await runDomainMergesForUser(session.userId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not tidy your map.';
    console.error('[tidy] runDomainMergesForUser failed', { userId: session.userId, message });
    return NextResponse.json({ error: 'tidy_failed', message }, { status: 500 });
  }

  await db.insert(activityItems).values({
    userId: session.userId,
    type: TIDY_ACTIVITY_TYPE,
    referenceId: result.mergesApplied > 0 ? result.details.map((detail) => detail.target).join(', ') : null,
    referenceType: 'knowledge_tidy',
  });

  return NextResponse.json(result);
}
