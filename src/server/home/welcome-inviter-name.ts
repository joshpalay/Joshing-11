import { getInviterForUser } from '@/server/db/queries/friend-invitations';
import { normalizePersonName } from '@/server/db/queries/users';

/**
 * Resolves the inviter name the first-run welcome tour personalizes its
 * For-You sample with (falls back to "a friend" in WelcomeTourScreen itself
 * when this is null).
 *
 * Pulled out of src/app/page.tsx (Stage 5 of the invite-link build) so this
 * one derived value can be tested in isolation — Home's own dependency graph
 * (buildHomeEdition, daily queue, ceremony, missed-return, friend requests,
 * ...) is otherwise disproportionate to mock just to cover this line.
 *
 * `tourActive` already encodes the account's durable post-first-game tour
 * eligibility at the call site; `userId` is null whenever there's no session.
 */
export async function getWelcomeInviterName(
  tourActive: boolean,
  userId: string | null,
): Promise<string | null> {
  if (!tourActive || !userId) return null;
  const inviter = await getInviterForUser(userId);
  return normalizePersonName(inviter?.inviterName);
}
