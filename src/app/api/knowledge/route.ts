import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import {
  toProgressionLandscape,
  getKnowledgePageData,
  getUserAnswerStreak,
  getUserMasteryOverview,
} from '@/server/db/queries/knowledge';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [mastery, streak, pageData] = await Promise.all([
    getUserMasteryOverview(session.userId),
    getUserAnswerStreak(session.userId),
    getKnowledgePageData(session.userId),
  ]);
  const progressionLandscape = toProgressionLandscape(pageData);

  return NextResponse.json({ mastery, streak, portraitData: null, progressionLandscape, pageData });
}
