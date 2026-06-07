import { and, eq, isNotNull } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { db, friendInvitations } from '@/server/db';
import { getPreSeededInterestsForUser, getUserOnboardingProfile } from '@/server/db/queries/users';
import { hasInviteLinkFriendship } from '@/server/friends/user-invite-token';
import { assessInterestAnswerability } from '@/server/llm/interests';
import { convergeDomain } from '@/server/knowledge/converge-domain';
import { isTooBroadInterest } from '@/lib/knowledge/interest-specificity';

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
  //
  // Two valid provenances: an accepted FriendInvitation (SMS-style) OR a
  // per-user invite-link friendship (/u/<handle>/<token>), which leaves an
  // approved follow edge but NO FriendInvitation row. Without the second check
  // invite-link signups fall through to redirect('/login'), which the proxy
  // bounces back into the onboarding-claim refresh → ERR_TOO_MANY_REDIRECTS.
  const hasInvitation = await db
    .select({ id: friendInvitations.id })
    .from(friendInvitations)
    .where(and(
      eq(friendInvitations.inviteeUserId, session.userId),
      isNotNull(friendInvitations.acceptedAt),
    ))
    .limit(1);

  if (hasInvitation.length === 0 && !(await hasInviteLinkFriendship(session.userId))) {
    redirect('/login');
  }

  const seeded = await getPreSeededInterestsForUser(session.userId);

  // Validate the inviter's free-text suggestions at the invitee's first login,
  // before the interests step renders. The inviter can seed anything ("your
  // mom"), so only the answerable, specific-enough seeds reach Jesse and
  // pre-populate his selection — he never sees the rejects. This reads the
  // stored invite without modifying it, and assessInterestAnswerability fails
  // open, so an LLM outage leaves the friend's picks intact. Seeds are capped at
  // 3, so this is at most a few parallel Haiku checks on a one-time page load.
  // Run each surviving seed through the same convergence pass as user-typed
  // adds: when a seed exactly matches a canonical domain that already exists
  // across the game, swap to that spelling so the invitee joins the shared
  // domain rather than minting a per-invite variant whose mastery never merges.
  // Deterministic and DB-only; only the high-confidence exact case is applied
  // silently — fuzzy seeds keep the inviter's wording (the invitee can still
  // edit, and any topics they type converge in the review step).
  const checkedSeeds = await Promise.all(
    seeded.interests.map(async (interest) => {
      if (isTooBroadInterest(interest.label)) return null;
      const { answerable } = await assessInterestAnswerability(interest.label);
      if (!answerable) return null;
      const { candidates } = await convergeDomain(interest.label);
      const exact = candidates.find((candidate) => candidate.kind === 'exact');
      return exact
        ? { ...interest, label: exact.label, broadCategory: exact.broadCategory ?? interest.broadCategory }
        : interest;
    }),
  );
  const preSeededInterests: PreSeededInterest[] = checkedSeeds
    .filter((interest): interest is NonNullable<typeof interest> => interest !== null)
    .map((interest) => ({
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
      initialHandle={user.handle}
    />
  );
}
