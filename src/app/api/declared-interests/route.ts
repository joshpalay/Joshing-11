import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { db, declaredInterests } from '@/server/db';
import {
  addDeclaredInterest,
  DeclaredInterestLimitError,
  type DeclaredInterestInput,
  MAX_ACTIVE_DECLARED_INTERESTS,
  removeDeclaredInterest,
  saveDeclaredInterests,
} from '@/server/db/queries/users';
import { TooBroadInterestError } from '@/lib/knowledge/interest-specificity';
import { UnanswerableInterestError } from '@/server/llm/interests';

const addInterestSchema = z.object({
  label: z.string().trim().min(1).max(80),
  broadCategory: z.string().trim().max(80).optional(),
});

const removeInterestSchema = z.object({
  domain: z.string().trim().min(1).max(80),
});

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

  // No product cap — only the defensive sanity bound shared with the DB layer.
  if (interests.length < 1 || interests.length > MAX_ACTIVE_DECLARED_INTERESTS) return null;
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
    .limit(MAX_ACTIVE_DECLARED_INTERESTS);

  return NextResponse.json({
    interests: interests.map((interest) => ({
      label: interest.domain,
      domain: interest.domain,
      broadCategory: interest.broadCategory,
      declaredAt: interest.declaredAt.toISOString(),
    })),
  });
}

// Append a single interest without replacing the existing list (PATCH replaces).
// Backs the "add a topic" field on the daily setup screen.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = addInterestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Enter a topic name (up to 80 characters).' },
      { status: 400 },
    );
  }

  try {
    const result = await addDeclaredInterest(session.userId, {
      label: parsed.data.label,
      broadCategory: parsed.data.broadCategory ?? null,
    });
    return NextResponse.json({
      domain: result.domain,
      broadCategory: result.broadCategory,
      tier: 'establishing',
      totalPoints: 0,
      created: result.created,
    });
  } catch (error) {
    if (error instanceof DeclaredInterestLimitError) {
      return NextResponse.json(
        { error: 'interest_limit_reached', message: error.message },
        { status: 409 },
      );
    }
    // The topic is a broad category, not a specific interest. Signal the client
    // to expand it into specific choices instead of saving it as-is.
    if (error instanceof TooBroadInterestError) {
      return NextResponse.json(
        {
          error: 'too_broad',
          topic: error.attempted,
          message: `"${error.attempted}" is a whole category. Pick something more specific within it.`,
        },
        { status: 422 },
      );
    }
    // The topic has no public factual basis (e.g. "my cat", gibberish). Signal
    // the client to surface the reason inline rather than save an empty domain.
    if (error instanceof UnanswerableInterestError) {
      return NextResponse.json(
        { error: 'unanswerable', topic: error.attempted, message: error.message },
        { status: 422 },
      );
    }
    const message = error instanceof Error ? error.message : 'Could not add that topic.';
    return NextResponse.json({ error: 'add_failed', message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as DeclaredInterestsBody | null;
  const interests = parseInterests(body?.interests);

  if (!interests) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Send at least 1 interest.' },
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

// Undo for a single incremental add (POST above) — the "Undo" link on the
// just-added confirmation banner. Deactivates one domain by name rather than
// replacing the whole list (PATCH), so it can't clobber an interest declared
// elsewhere in the meantime. Idempotent: undoing twice, or a domain that was
// never active, is a harmless no-op.
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = removeInterestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Send the domain to remove.' },
      { status: 400 },
    );
  }

  const removed = await removeDeclaredInterest(session.userId, parsed.data.domain);
  return NextResponse.json({ removed });
}
