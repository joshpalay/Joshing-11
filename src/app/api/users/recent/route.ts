import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getRecentDirectSendRecipients } from '@/server/db/queries/friends';
import { resolveDisplayName } from '@/server/lib/display-name';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const rows = await getRecentDirectSendRecipients(session.userId, 3);

  return NextResponse.json(
    rows.map((user) => ({
      id: user.id,
      displayName: resolveDisplayName(user),
    })),
  );
}
