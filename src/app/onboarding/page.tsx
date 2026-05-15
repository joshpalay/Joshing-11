import { redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { getPreSeededInterestsForUser, getUserOnboardingProfile } from '@/server/db/queries/users';
import { hasAcceptedInvitationForUser } from '@/server/friends/invitations';

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

  // Belt-and-suspenders: middleware enforces this app-wide, but the
  // onboarding page is the last natural choke-point before full access.
  // If we ever ship a code path that mints a session without verifying
  // invitation acceptance, this check catches it.
  const hasInvitation = await hasAcceptedInvitationForUser(session.userId);
  if (!hasInvitation) {
    redirect('/login?reason=no_invitation');
  }

  if (user.onboardingComplete) {
    redirect('/');
  }

  const seeded = await getPreSeededInterestsForUser(session.userId);
  const preSeededInterests: PreSeededInterest[] = seeded.interests.map((interest) => ({
    domain: interest.label,
    broadCategory: interest.broadCategory ?? 'General Knowledge',
    rationale: interest.description ?? null,
  }));

  return <OnboardingFlow preSeededInterests={preSeededInterests} inviterName={seeded.inviterName} />;
}
