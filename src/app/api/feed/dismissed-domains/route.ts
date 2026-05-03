import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getDismissedDomains } from '@/server/db/queries/feed';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const domains = await getDismissedDomains(session.userId);
  return NextResponse.json({ domains });
}
