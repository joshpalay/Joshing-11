import { redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import {
  getPreSeededInterestsForUser,
  getUserOnboardingProfile,
} from '@/server/db/queries/users';

import OnboardingFlow from './OnboardingFlow';

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

  const preSeededInterests = await getPreSeededInterestsForUser(user.id);

  return <OnboardingFlow preSeededInterests={preSeededInterests} />;
}
