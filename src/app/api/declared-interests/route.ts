import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { db, declaredInterests } from '@/server/db';
import { type DeclaredInterestInput, saveDeclaredInterests } from '@/server/db/queries/users';

type DeclaredInterestsBody = {
  interests?: unknown;
};

function parseInterest(value: unknown): DeclaredInterestInput | null {
  if (typeof value === 'string') {
    const label = value.trim();
    return label ? { label } : null;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const label = typeof record.label === 'string' ? record.label.trim() : '';
  if (!label) return null;

  return {
    label,
    broadCategory:
      typeof record.broadCategory === 'string'
        ? record.broadCategory.trim()
        : typeof record.broad_category === 'string'
          ? record.broad_category.trim()
          : null,
    description: typeof record.description === 'string' ? record.description.trim() : null,
  };
}

function parseInterests(value: unknown): DeclaredInterestInput[] | null {
  if (!Array.isArray(value)) return null;
  const interests = value.flatMap((item) => {
    const parsed = parseInterest(item);
    return parsed ? [parsed] : [];
  });

  if (interests.length < 1 || interests.length > 5) return null;
  return interests;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const interests = await db
    .select({
      domain: declaredInterests.domain,
      broadCategory: declaredInterests.broadCategory,
      declaredAt: declaredInterests.declaredAt,
    })
    .from(declaredInterests)
    .where(and(eq(declaredInterests.userId, session.userId), eq(declaredInterests.isActive, true)))
    .orderBy(asc(declaredInterests.declaredAt))
    .limit(5);

  return NextResponse.json({
    interests: interests.map((interest) => ({
      label: interest.domain,
      domain: interest.domain,
      broadCategory: interest.broadCategory,
      declaredAt: interest.declaredAt.toISOString(),
    })),
  });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as DeclaredInterestsBody | null;
  const interests = parseInterests(body?.interests);

  if (!interests) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Send 1 to 5 interests.' },
      { status: 400 },
    );
  }

  try {
    const savedInterests = await saveDeclaredInterests(session.userId, interests);
    return NextResponse.json({ interests: savedInterests });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save interests.';
    return NextResponse.json({ error: 'save_failed', message }, { status: 400 });
  }
}
