import { and, eq, isNotNull } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { db, friendInvitations } from '@/server/db';
import { getPreSeededInterestsForUser, getUserOnboardingProfile } from '@/server/db/queries/users';

import OnboardingFlow, { type PreSeededInterest } from './OnboardingFlow';

export default async function OnboardingPage() {
  const session = await getSession();

  if (!session) {
    redirect('/login');
  }

  const user = await getUserOnboardingProfile(session.userId);
  if (!user) {
    redirect('/login');
  }

  if (user.onboardingComplete) {
    redirect('/');
  }

  // Belt-and-suspenders invitation check: the middleware JWT gate runs first,
  // but this protects the onboarding route against any future session path
  // that bypasses the general gate (e.g. a pre-fix legacy session that was
  // grandfathered through re-login).
  const hasInvitation = await db
    .select({ id: friendInvitations.id })
    .from(friendInvitations)
    .where(and(
      eq(friendInvitations.inviteeUserId, session.userId),
      isNotNull(friendInvitations.acceptedAt),
    ))
    .limit(1);

  if (hasInvitation.length === 0) {
    redirect('/login');
  }

  const seeded = await getPreSeededInterestsForUser(session.userId);
  const preSeededInterests: PreSeededInterest[] = seeded.interests.map((interest) => ({
    domain: interest.label,
    broadCategory: interest.broadCategory ?? 'General Knowledge',
    rationale: interest.description ?? null,
  }));

  return (
    <OnboardingFlow
      preSeededInterests={preSeededInterests}
      inviterName={seeded.inviterName}
      inviteeDisplayName={seeded.inviteeDisplayName}
      initialDisplayName={user.displayName}
    />
  );
}
