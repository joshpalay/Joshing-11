import { redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { getUserOnboardingProfile } from '@/server/db/queries/users';

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

  // TODO Phase 11: load preSeededInterests from invitation token
  // when friend invitation flow is built.
  const preSeededInterests: PreSeededInterest[] = [];

  return <OnboardingFlow preSeededInterests={preSeededInterests} />;
}
