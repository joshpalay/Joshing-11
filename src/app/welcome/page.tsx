import { redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { getPreSeededInterestsForUser } from '@/server/db/queries/users';
import WelcomeTourScreen from '@/components/welcome/WelcomeTourScreen';

export const dynamic = 'force-dynamic';

/**
 * First-run welcome tour — the overview a new player sees right after
 * onboarding (OnboardingFlow routes here once areas-of-knowledge is saved and
 * first-Five generation has kicked off in the background).
 *
 * The screen is self-contained (its own mock home + nav). It uses the real
 * inviter's name in the For-You sample, and self-suppresses once seen (so a
 * refresh/back doesn't re-run it). "Play Now" drops straight into the round;
 * "I'll explore more first" lands on home with the one-time first-five note.
 */
export default async function WelcomePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const { inviterName } = await getPreSeededInterestsForUser(session.userId);

  return (
    <WelcomeTourScreen inviterName={inviterName} playHref="/daily" exploreHref="/?firstrun=1" />
  );
}
