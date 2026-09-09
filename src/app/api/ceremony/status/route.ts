import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getLatestUnviewedCeremony, getNextCeremonyAt } from '@/server/db/queries/ceremony';

export const dynamic = 'force-dynamic';

/**
 * Returns the current user's ceremony viewing status: whether an unviewed
 * ceremony exists, and when the next one fires.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const now = new Date();
  const nextFireAt = getNextCeremonyAt(now);
  const latest = await getLatestUnviewedCeremony(session.userId);

  return NextResponse.json({
    nextFireAt: nextFireAt.toISOString(),
    latestUnviewed: latest
      ? { id: latest.id, firedAt: latest.firedAt.toISOString() }
      : null,
  });
}
