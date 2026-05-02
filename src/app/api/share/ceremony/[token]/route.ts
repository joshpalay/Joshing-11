import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getCeremonyByShareToken } from '@/lib/share-card';
import { db, users } from '@/server/db';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  const ceremony = await getCeremonyByShareToken(token);
  if (!ceremony) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const [owner] = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, ceremony.userId))
    .limit(1);

  return NextResponse.json({
    userName: owner?.displayName?.trim() || 'Someone',
    cycleStart: ceremony.cycleStart,
    cycleEnd: ceremony.cycleEnd,
    beatsPayload: ceremony.beatsPayload,
  });
}
