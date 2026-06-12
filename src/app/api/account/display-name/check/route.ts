import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { findDisplayNameMatches } from '@/server/db/queries/account';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const displayName = (url.searchParams.get('displayName') ?? '').trim();

  if (displayName.length < 1 || displayName.length > 60) {
    return NextResponse.json(
      { error: 'invalid_display_name', message: 'Display name must be 1–60 characters.' },
      { status: 400 },
    );
  }

  const matches = await findDisplayNameMatches(displayName, session.userId);
  return NextResponse.json({ duplicate: matches.length > 0, count: matches.length });
}
