import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import {
  getDomainDetail,
  setDomainVisibility,
  type DomainVisibility,
} from '@/server/db/queries/knowledge';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ domain: string }>;
};

function parseVisibility(value: unknown): DomainVisibility | null {
  return value === 'public' || value === 'friends' || value === 'private' ? value : null;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { domain } = await context.params;
  const decodedDomain = decodeURIComponent(domain);
  const detail = await getDomainDetail(session.userId, decodedDomain);
  if (!detail) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json(detail);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null) as { visibility?: unknown } | null;
  const visibility = parseVisibility(body?.visibility);
  if (!visibility) {
    return NextResponse.json(
      { error: 'validation', message: 'visibility must be public, friends, or private' },
      { status: 400 },
    );
  }

  const { domain } = await context.params;
  await setDomainVisibility(session.userId, decodeURIComponent(domain), visibility);
  const detail = await getDomainDetail(session.userId, decodeURIComponent(domain));

  return NextResponse.json({ visibility, detail });
}
