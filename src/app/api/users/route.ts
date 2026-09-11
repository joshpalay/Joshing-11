import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getFriends } from '@/server/db/queries/friends';
import { resolveDisplayName } from '@/server/lib/display-name';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const rows = await getFriends(session.userId);

  return NextResponse.json(
    rows.map((user) => ({
      id: user.id,
      displayName: resolveDisplayName(user),
    })),
  );
}
