import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getLearnedThisWeek } from '@/server/db/queries/learned';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const items = await getLearnedThisWeek(session.userId);
  return NextResponse.json({ items, total: items.length });
}
