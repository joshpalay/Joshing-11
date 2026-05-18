import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getLatestUnviewedCeremony, getNextCeremonyAt } from '@/server/db/queries/ceremony';

export const dynamic = 'force-dynamic';

/**
 * Drives the top-of-feed ceremony row. Three states the client renders:
 *   - latestUnviewed present                  → pinned card "Ceremony ready"
 *   - day of week is Sunday (UTC)             → hidden (cron is firing now)
 *   - otherwise                               → countdown "Ceremony in N days"
 *
 * nextFireAt is always returned so the client can compute "N days" without
 * an extra round-trip; the server computes it the same way to avoid timezone
 * drift between client clocks and the cron schedule.
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
