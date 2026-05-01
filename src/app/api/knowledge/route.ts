import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import {
  getProgressionLandscape,
  getKnowledgePageData,
  getUserAnswerStreak,
  getUserMasteryOverview,
} from '@/server/db/queries/knowledge';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [mastery, streak, pageData, progressionLandscape] = await Promise.all([
    getUserMasteryOverview(session.userId),
    getUserAnswerStreak(session.userId),
    getKnowledgePageData(session.userId),
    getProgressionLandscape(session.userId),
  ]);

  return NextResponse.json({ mastery, streak, portraitData: null, progressionLandscape, pageData });
}
