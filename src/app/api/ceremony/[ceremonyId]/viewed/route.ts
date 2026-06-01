import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { biweeklyCeremonies, db } from '@/server/db';
import { getCeremonyById } from '@/server/db/queries/ceremony';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ ceremonyId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { ceremonyId } = await context.params;
  const ceremony = await getCeremonyById(ceremonyId);
  if (!ceremony) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (ceremony.userId !== session.userId)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  if (!ceremony.viewedAt) {
    await db
      .update(biweeklyCeremonies)
      .set({ viewedAt: new Date() })
      .where(and(eq(biweeklyCeremonies.id, ceremonyId), isNull(biweeklyCeremonies.viewedAt)));
  }

  return NextResponse.json({ ok: true });
}
