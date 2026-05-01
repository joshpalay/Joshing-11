import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getActivitiesForUser, getUnreadCount } from '@/server/db/queries/activity';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [items, unreadCount] = await Promise.all([
    getActivitiesForUser(session.userId),
    getUnreadCount(session.userId),
  ]);

  return NextResponse.json({ items, unreadCount });
}
