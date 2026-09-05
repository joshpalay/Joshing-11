import { and, eq, isNotNull } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { db, friendInvitations } from '@/server/db';
import { getInviterForUser } from '@/server/db/queries/friend-invitations';
import {
  getPreSeededInterestsForUser,
  getUserOnboardingProfile,
  normalizePersonName,
} from '@/server/db/queries/users';
import {
  getInviteLinkSeedTopics,
  getSeedTopicsForJoinedLink,
  hasInviteLinkFriendship,
} from '@/server/friends/user-invite-token';
import { getCatalogSuggestions } from '@/server/db/queries/suggestion-catalog';
import { assessInterestAnswerability } from '@/server/llm/interests';
import { convergeDomain } from '@/server/knowledge/converge-domain';
import { isTooBroadInterest } from '@/lib/knowledge/interest-specificity';
import { domainKey } from '@/lib/knowledge/domain-key';
import { getReminderState } from '@/server/db/queries/account';
import { shouldOfferReminderAcquisition } from '@/server/reminders/acquisition';

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

  const reminderState = await getReminderState(session.userId);
  const showReminderOffer = reminderState
    ? shouldOfferReminderAcquisition(reminderState)
    : false;

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

  let seeded = await getPreSeededInterestsForUser(session.userId);
  // 'named': topics came from friendInvitations.preSeededInterests — the
  // inviter chose them FOR this person, so OnboardingFlow pre-selects them.
  // 'link': topics came from the per-user invite link's own resolution below
  // — they may reach anyone, so OnboardingFlow must NOT pre-select them.
  let seedSource: 'named' | 'link' = 'named';

  if (seeded.interests.length === 0) {
    const inviter = await getInviterForUser(session.userId);
    // Only fall back when the resolved provenance is genuinely the invite-link
    // follow edge (no FriendInvitation at all). A named invite with a *empty*
    // seed list also lands here with `seeded.interests.length === 0`, but its
    // getInviterForUser resolution is sourceType 'friend_invitation' — Stage 2
    // must not change what that case shows, so it's deliberately excluded.
    if (inviter?.sourceType === 'follow') {
      // Slot-precise first: which SPECIFIC link this invitee clicked
      // (users.joined_via_invite_link_id) resolves to just that link's topic
      // for a tagged link, or all of the inviter's topics for an untagged
      // one — B-FRIENDS-INVITE-LINKS-01. Falls back to the old ambient
      // "all of the inviter's topics" resolution only when attribution is
      // missing (pre-migration accounts, or the rare organic mutual-follow
      // this fallback window also catches without an actual link).
      const topics =
        (await getSeedTopicsForJoinedLink(session.userId)) ??
        (await getInviteLinkSeedTopics(inviter.inviterUserId));
      seeded = {
        interests: topics,
        inviterName: normalizePersonName(inviter.inviterName),
        inviteeDisplayName: seeded.inviteeDisplayName,
      };
      seedSource = 'link';
    }
  }

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

  // A tagged invite link deliberately carries just ONE topic (seedSource
  // 'link' never pre-selects, so this doesn't change that) — break the
  // MIN_INTERESTS=3 blank-screen wall with a few real, verified-question
  // domains from the SAME broad categories, not a random/invented set.
  // Skipped when there's nothing to be adjacent to (an untagged link whose
  // inviter also has no topics yet) — no fabricated suggestions.
  if (seedSource === 'link' && preSeededInterests.length > 0 && preSeededInterests.length < 3) {
    const seededKeys = new Set(preSeededInterests.map((interest) => domainKey(interest.domain)));
    const broadCategories = [
      ...new Set(preSeededInterests.map((interest) => interest.broadCategory).filter(Boolean)),
    ];
    const adjacent = await getCatalogSuggestions(broadCategories, seededKeys, 3 - preSeededInterests.length);
    for (const suggestion of adjacent) {
      preSeededInterests.push({
        domain: suggestion.domain,
        broadCategory: suggestion.broadCategory ?? 'General Knowledge',
        rationale: null,
      });
    }
  }

  return (
    <OnboardingFlow
      preSeededInterests={preSeededInterests}
      seedSource={seedSource}
      inviterName={seeded.inviterName}
      inviteeDisplayName={seeded.inviteeDisplayName}
      initialDisplayName={user.displayName}
      initialHandle={user.handle}
      phoneNumber={user.phoneNumber}
      showReminderOffer={showReminderOffer}
    />
  );
}
