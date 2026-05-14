import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { db, userDomainExclusions } from '@/server/db';

export const dynamic = 'force-dynamic';

function parseDomain(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const domain = (value as Record<string, unknown>).canonical_subcategory;
  return typeof domain === 'string' && domain.trim() ? domain.trim().replace(/\s+/g, ' ') : null;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const domain = parseDomain(await request.json().catch(() => null));
  if (!domain) {
    return NextResponse.json({ error: 'validation', message: 'canonical_subcategory is required' }, { status: 400 });
  }

  await db
    .insert(userDomainExclusions)
    .values({ userId: session.userId, canonicalSubcategory: domain })
    .onConflictDoNothing({
      target: [userDomainExclusions.userId, userDomainExclusions.canonicalSubcategory],
    });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const domain = parseDomain(await request.json().catch(() => null));
  if (!domain) {
    return NextResponse.json({ error: 'validation', message: 'canonical_subcategory is required' }, { status: 400 });
  }

  await db
    .delete(userDomainExclusions)
    .where(and(
      eq(userDomainExclusions.userId, session.userId),
      eq(userDomainExclusions.canonicalSubcategory, domain),
    ));

  return NextResponse.json({ ok: true });
}
