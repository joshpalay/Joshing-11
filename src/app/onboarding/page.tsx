import { redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';
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

  const seeded = await getPreSeededInterestsForUser(session.userId);
  const preSeededInterests: PreSeededInterest[] = seeded.interests.map((interest) => ({
    domain: interest.label,
    broadCategory: interest.broadCategory ?? 'Other',
    rationale: interest.description ?? null,
  }));

  return <OnboardingFlow preSeededInterests={preSeededInterests} inviterName={seeded.inviterName} />;
}
