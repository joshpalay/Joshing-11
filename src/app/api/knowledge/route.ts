import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import {
  getProgressionLandscape,
  getKnowledgePageData,
  getUserAnswerStreak,
  getUserMasteryOverview,
} from '@/server/db/queries/knowledge';
import { ensureAuthoredDomainsOpened } from '@/server/knowledge/open-domain';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Self-heal any authored questions whose territory failed to open during
  // /api/questions creation (the openKBDomain try/catch swallows transient
  // failures so the question save isn't blocked). Idempotent and cheap when
  // there's nothing to backfill. Failure here must not block the page render
  // — fall through to the read queries either way.
  await ensureAuthoredDomainsOpened(session.userId).catch((error) => {
    console.error('[knowledge/GET] ensureAuthoredDomainsOpened failed; continuing', {
      userId: session.userId,
      message: error instanceof Error ? error.message : String(error),
    });
  });

  const [mastery, streak, pageData, progressionLandscape] = await Promise.all([
    getUserMasteryOverview(session.userId),
    getUserAnswerStreak(session.userId),
    getKnowledgePageData(session.userId),
    getProgressionLandscape(session.userId),
  ]);

  return NextResponse.json({ mastery, streak, portraitData: null, progressionLandscape, pageData });
}
