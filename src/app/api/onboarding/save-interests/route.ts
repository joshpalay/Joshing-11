import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import {
  type DeclaredInterestInput,
  markOnboardingComplete,
  saveDeclaredInterests,
} from '@/server/db/queries/users';

type SaveInterestsBody = {
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
    description: typeof record.description === 'string' ? record.description.trim() : null,
    broadCategory:
      typeof record.broadCategory === 'string'
        ? record.broadCategory.trim()
        : typeof record.broad_category === 'string'
          ? record.broad_category.trim()
          : null,
  };
}

function parseInterests(value: unknown): DeclaredInterestInput[] | null {
  if (!Array.isArray(value)) return null;

  const interests = value.flatMap((item) => {
    const parsed = parseInterest(item);
    return parsed ? [parsed] : [];
  });

  if (interests.length === 0 || interests.length > 5) return null;

  return interests;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as SaveInterestsBody | null;
  const interests = parseInterests(body?.interests);

  if (!interests) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Select 1 to 5 interests.' },
      { status: 400 },
    );
  }

  try {
    const savedInterests = await saveDeclaredInterests(session.userId, interests);
    await markOnboardingComplete(session.userId);

    return NextResponse.json({ interests: savedInterests, onboardingComplete: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save interests.';
    return NextResponse.json({ error: 'save_failed', message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  return POST(request);
}
