import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getCeremonyById } from '@/server/db/queries/ceremony';
import { buildShareCardUrl, generateShareCardToken } from '@/lib/share-card';

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

  const token = ceremony.shareCardToken ?? (await generateShareCardToken(ceremonyId));
  return NextResponse.json({ token, url: buildShareCardUrl(token) });
}
