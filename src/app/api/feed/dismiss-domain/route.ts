import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { dismissDomain, reinstateDomain } from '@/server/db/queries/feed';

export const dynamic = 'force-dynamic';

function parseDomain(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const domain = (value as Record<string, unknown>).domain;
  return typeof domain === 'string' && domain.trim() ? domain.trim() : null;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const domain = parseDomain(await request.json().catch(() => null));
  if (!domain) {
    return NextResponse.json({ error: 'validation', message: 'domain is required' }, { status: 400 });
  }

  await dismissDomain(session.userId, domain);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const domain = parseDomain(await request.json().catch(() => null));
  if (!domain) {
    return NextResponse.json({ error: 'validation', message: 'domain is required' }, { status: 400 });
  }

  await reinstateDomain(session.userId, domain);
  return NextResponse.json({ ok: true });
}
