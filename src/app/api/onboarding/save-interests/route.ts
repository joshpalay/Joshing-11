import { NextResponse } from 'next/server';

import {
  getSession,
  refreshSessionOnboardingClaim,
} from '@/server/auth/session';
import { normalizeBroadCategory } from '@/lib/knowledge/broad-category';
import { logTelemetry } from '@/server/telemetry';
import {
  type DeclaredInterestInput,
  getUserOnboardingProfile,
  markOnboardingComplete,
  MAX_ACTIVE_DECLARED_INTERESTS,
  saveDeclaredInterests,
} from '@/server/db/queries/users';

type SaveInterestsBody = {
  interests?: unknown;
  telemetry?: unknown;
};

// Onboarding's build-your-world screen caps the selection at 12 (per product
// spec); the client mirrors this with MAX_INTERESTS in OnboardingFlow. This is
// the onboarding-specific ceiling and is intentionally lower than the
// account-wide MAX_ACTIVE_DECLARED_INTERESTS used on daily setup / the
// knowledge page.
const MAX_ONBOARDING_INTERESTS = 12;

function parseInterest(value: unknown): DeclaredInterestInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const domain = typeof record.domain === 'string' ? record.domain.trim().replace(/\s+/g, ' ') : '';
  if (domain.length < 2 || domain.length > 100) return null;

  const broadCategory = typeof record.broadCategory === 'string' && record.broadCategory.trim()
    ? normalizeBroadCategory(record.broadCategory)
    : null;

  return {
    label: domain,
    broadCategory: broadCategory ? broadCategory.slice(0, 80) : null,
  };
}

function parseOnboardingTelemetry(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { inviteInterestCount: 0, inviteSelectedCount: 0 };
  }

  const record = value as Record<string, unknown>;
  const inviteInterestCount =
    typeof record.inviteInterestCount === 'number' && Number.isFinite(record.inviteInterestCount)
      ? Math.max(0, Math.min(5, Math.trunc(record.inviteInterestCount)))
      : 0;
  const inviteSelectedCount =
    typeof record.inviteSelectedCount === 'number' && Number.isFinite(record.inviteSelectedCount)
      ? Math.max(0, Math.min(inviteInterestCount, Math.trunc(record.inviteSelectedCount)))
      : 0;

  return { inviteInterestCount, inviteSelectedCount };
}

function parseInterests(value: unknown): DeclaredInterestInput[] | null {
  // No product cap — only the defensive sanity bound shared with the DB layer.
  if (!Array.isArray(value) || value.length > MAX_ACTIVE_DECLARED_INTERESTS) return null;

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
  const telemetry = parseOnboardingTelemetry(body?.telemetry);

  const isInviteSkip = Boolean(
    interests &&
    interests.length === 0 &&
    telemetry.inviteInterestCount > 0 &&
    telemetry.inviteSelectedCount === 0
  );

  if (!interests || (interests.length === 0 && !isInviteSkip)) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Save at least 1 interest, or skip invite suggestions. Domains must be 2 to 100 characters.' },
      { status: 400 },
    );
  }

  if (interests.length > MAX_ONBOARDING_INTERESTS) {
    return NextResponse.json(
      { error: 'invalid_request', message: `Pick ${MAX_ONBOARDING_INTERESTS} interests or fewer.` },
      { status: 400 },
    );
  }

  const profile = await getUserOnboardingProfile(session.userId);
  if (!profile?.displayName?.trim()) {
    return NextResponse.json(
      {
        error: 'display_name_required',
        message: 'Choose a display name before finishing onboarding.',
      },
      { status: 409 },
    );
  }

  try {
    await saveDeclaredInterests(session.userId, interests);
    await markOnboardingComplete(session.userId);
    await refreshSessionOnboardingClaim();

    if (telemetry.inviteInterestCount > 0) {
      const event = telemetry.inviteSelectedCount === 0
        ? 'friend_onboarding_interests_skipped'
        : telemetry.inviteSelectedCount >= telemetry.inviteInterestCount
          ? 'friend_onboarding_interests_accepted_all'
          : 'friend_onboarding_interests_partial';

      logTelemetry(event, {
        user_id: session.userId,
        invite_interest_count: telemetry.inviteInterestCount,
        invite_interest_selected_count: telemetry.inviteSelectedCount,
        saved_interest_count: interests.length,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save interests.';
    return NextResponse.json({ error: 'save_failed', message }, { status: 400 });
  }
}
