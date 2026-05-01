import { NextRequest, NextResponse } from 'next/server';

import { getDailyAssignmentBounds } from '@/lib/games/timezone';
import { getSession } from '@/server/auth/session';
import { getDailySummary } from '@/server/db/queries/daily-summary';

export const dynamic = 'force-dynamic';

function parseDateParam(value: string | null): Date {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00.000Z`);
  }
  return new Date(`${getDailyAssignmentBounds().assignmentDateStr}T00:00:00.000Z`);
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const date = parseDateParam(request.nextUrl.searchParams.get('date'));
  const summary = await getDailySummary(session.userId, date);

  return NextResponse.json(summary);
}
