import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import {
  getKnowledgePageData,
  getUserMasteryOverview,
  loadKnowledgeInputs,
} from '@/server/db/queries/knowledge';
import { ensureAuthoredDomainsOpened } from '@/server/knowledge/open-domain';
import { createServerTiming, logServerTiming } from '@/server/lib/server-timing';

export const dynamic = 'force-dynamic';

export async function GET() {
  const timing = createServerTiming();
  const startedAt = Date.now();
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Self-heal any authored questions whose territory failed to open during
  // /api/questions creation (the openKBDomain try/catch swallows transient
  // failures so the question save isn't blocked). Idempotent and cheap when
  // there's nothing to backfill. Failure here must not block the page render.
  // Runs concurrently with the read queries: its inserts are rare, and a
  // one-request-stale read of a just-opened domain is acceptable.
  const ensureOpened = ensureAuthoredDomainsOpened(session.userId).catch((error) => {
    console.error('[knowledge/GET] ensureAuthoredDomainsOpened failed; continuing', {
      userId: session.userId,
      message: error instanceof Error ? error.message : String(error),
    });
  });

  // Both the mastery overview and the page data derive from the same declared
  // interests / mastery rows / events / hidden keys — fetch them once and share.
  const inputs = await loadKnowledgeInputs(session.userId);
  const [mastery, pageData] = await Promise.all([
    getUserMasteryOverview(session.userId, inputs),
    getKnowledgePageData(session.userId, inputs),
  ]);
  await ensureOpened;
  timing.measure('knowledge', startedAt);
  logServerTiming('knowledge', timing);

  const response = NextResponse.json({ mastery, pageData });
  response.headers.set('Server-Timing', timing.toHeader());
  return response;
}
