import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { buildLoadingMomentPayload } from '@/server/loading-moment/build-payload';

export const dynamic = 'force-dynamic';

/**
 * Returns the cached-only Loading Moment payload for the signed-in user
 * (B-LOADING-MOMENT-01). The client primes this from a STABLE screen (the home
 * page), stores the result in client-session storage, and the loading screen
 * reads only that stored value — so this endpoint never sits on a loading
 * critical path (C-1). It assembles already-modelled facts (no new metric
 * computation) and only emits a card field when the fact is real (C-2).
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const payload = await buildLoadingMomentPayload(session.userId);
  return NextResponse.json(payload);
}
