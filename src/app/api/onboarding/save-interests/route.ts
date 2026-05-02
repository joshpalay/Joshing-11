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
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const domain = typeof record.domain === 'string' ? record.domain.trim().replace(/\s+/g, ' ') : '';
  if (domain.length < 2 || domain.length > 100) return null;

  return {
    label: domain,
    broadCategory: typeof record.broadCategory === 'string' && record.broadCategory.trim()
      ? record.broadCategory.trim().slice(0, 80)
      : null,
  };
}

function parseInterests(value: unknown): DeclaredInterestInput[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) return null;

  const interests = value.map(parseInterest);
  if (interests.some((interest) => !interest)) return null;

  return interests as DeclaredInterestInput[];
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
      { error: 'invalid_request', message: 'Save 1 to 5 interests. Domains must be 2 to 100 characters.' },
      { status: 400 },
    );
  }

  try {
    await saveDeclaredInterests(session.userId, interests);
    await markOnboardingComplete(session.userId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save interests.';
    return NextResponse.json({ error: 'save_failed', message }, { status: 400 });
  }
}
