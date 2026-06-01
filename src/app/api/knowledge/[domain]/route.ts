import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import {
  getDomainDetail,
  removeKnowledgeDomain,
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

  const body = (await request.json().catch(() => null)) as { visibility?: unknown } | null;
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

// Undo for the default-add that opens a domain on a correct answer in
// unfamiliar territory (B-1). Deletes the freshly-opened domain from the
// player's Knowledge base. Surfaced only by the reveal-time "remove" control.
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { domain } = await context.params;
  const decodedDomain = decodeURIComponent(domain).trim();
  if (!decodedDomain) {
    return NextResponse.json(
      { error: 'validation', message: 'domain is required' },
      { status: 400 },
    );
  }

  const { removed } = await removeKnowledgeDomain(session.userId, decodedDomain);
  return NextResponse.json({ ok: true, removed });
}
