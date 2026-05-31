import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import {
  AREA_TOP_UP_MAX_INTERESTS,
  getAreaTopUpContext,
} from '@/server/db/queries/area-top-up';

// GET /api/declared-interests/top-up
//
// Cheap eligibility check for the one-time "add two more areas" prompt shown
// on the daily page. Returns whether the prompt should show plus the user's
// existing interests (so the client can send the union when saving) and how
// many more areas they may add.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const context = await getAreaTopUpContext(session.userId);
  if (!context) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({
    eligible: context.eligible,
    existing: context.existing.map((interest) => ({
      label: interest.domain,
      broadCategory: interest.broadCategory,
    })),
    remainingSlots: Math.max(0, AREA_TOP_UP_MAX_INTERESTS - context.existing.length),
  });
}
