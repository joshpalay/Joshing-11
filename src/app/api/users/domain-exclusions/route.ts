import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { db, userDomainExclusions } from '@/server/db';

export const dynamic = 'force-dynamic';

const exclusionPayloadSchema = z.object({
  canonical_subcategory: z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.replace(/\s+/g, ' ')),
  scope: z.enum(['subcategory', 'broad_category', 'category']).default('subcategory'),
});

async function parsePayload(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = exclusionPayloadSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const payload = await parsePayload(request);
  if (!payload) {
    return NextResponse.json(
      { error: 'validation', message: 'canonical_subcategory is required' },
      { status: 400 },
    );
  }

  await db
    .insert(userDomainExclusions)
    .values({
      userId: session.userId,
      canonicalSubcategory: payload.canonical_subcategory,
      scope: payload.scope,
    })
    .onConflictDoNothing({
      target: [
        userDomainExclusions.userId,
        userDomainExclusions.scope,
        userDomainExclusions.canonicalSubcategory,
      ],
    });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const payload = await parsePayload(request);
  if (!payload) {
    return NextResponse.json(
      { error: 'validation', message: 'canonical_subcategory is required' },
      { status: 400 },
    );
  }

  await db
    .delete(userDomainExclusions)
    .where(
      and(
        eq(userDomainExclusions.userId, session.userId),
        eq(userDomainExclusions.scope, payload.scope),
        eq(userDomainExclusions.canonicalSubcategory, payload.canonical_subcategory),
      ),
    );

  return NextResponse.json({ ok: true });
}
