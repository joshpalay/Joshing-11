import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { db, userDomainExclusions } from '@/server/db';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ domain: string }>;
};

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { domain: rawDomain } = await context.params;
  const domain = decodeURIComponent(rawDomain).trim().replace(/\s+/g, ' ');
  if (!domain) {
    return NextResponse.json({ error: 'validation', message: 'domain is required' }, { status: 400 });
  }

  await db
    .delete(userDomainExclusions)
    .where(and(
      eq(userDomainExclusions.userId, session.userId),
      eq(userDomainExclusions.canonicalSubcategory, domain),
    ));

  return NextResponse.json({ ok: true });
}
