import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import {
  getLastContactHashUpload,
  isRefreshDue,
  listContactMatches,
} from '@/server/db/queries/contact-hashes';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [matches, lastUploadedAt] = await Promise.all([
    listContactMatches(session.userId),
    getLastContactHashUpload(session.userId),
  ]);

  return NextResponse.json({
    matches,
    lastUploadedAt: lastUploadedAt?.toISOString() ?? null,
    refreshDue: isRefreshDue(lastUploadedAt),
  });
}
