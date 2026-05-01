import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getCeremonyBanner } from '@/server/db/queries/ceremony';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const ceremony = await getCeremonyBanner(session.userId);
  return NextResponse.json({
    ceremony: ceremony ? { id: ceremony.id, firedAt: ceremony.firedAt } : null,
  });
}
