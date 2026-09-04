/**
 * Homepage "add friends" promo.
 *
 * Produces a single, optional `StreamItem` (the inline add-friends embed) that
 * the home feed splices a few rows down. Shown on ~1 in 5 visits (gated first,
 * like the common-ground promo, so the visits we skip do no reads); when shown
 * it takes one of two shapes — never both:
 *   1. `suggestions` — contact-match people the viewer can follow, each with an
 *      Add affordance.
 *   2. `invite` — when there are no addable matches, a copy-only nudge toward
 *      /friends.
 *
 * HOME-ONLY: assembled here, not in buildActivityStream, so /activities and
 * Lately stay free of the promo. Stateless — no per-user counter.
 */

import {
  addFriendsPromoToStreamItem,
  type StreamEmbed,
  type StreamItem,
} from '@/lib/activity-stream';
import { listContactMatches } from '@/server/db/queries/contact-hashes';

const MAX_SUGGESTIONS = 3;
const FRIENDS_HREF = '/friends';

export async function getAddFriendsPromo(
  userId: string,
  now: Date = new Date(),
): Promise<StreamItem | null> {
  // First-class module: always render (suggestions when there are addable
  // matches, otherwise the invite nudge) so the viewer can grow their circle.
  const matches = await listContactMatches(userId);
  // Addable = a NEW follow is the action: 'none' (no edge) or 'follows_you'
  // (they follow me; I can follow back). Anyone already requested / following /
  // friends is dropped — there's nothing to add.
  const addable = matches.filter(
    (m) => m.relationship.state === 'none' || m.relationship.state === 'follows_you',
  );

  // Stable id within a UTC day so the row's React key doesn't churn across
  // re-renders, but advances day to day.
  const daySeed = Math.floor(now.getTime() / 86_400_000);

  if (addable.length > 0) {
    const people = addable.slice(0, MAX_SUGGESTIONS).map((m) => ({
      id: m.id,
      displayName: m.displayName ?? m.handle ?? 'Someone you know',
      handle: m.handle,
      avatarColor: m.avatarColor,
      relationship: m.relationship,
    }));
    const embed: Extract<StreamEmbed, { kind: 'add_friends'; variant: 'suggestions' }> = {
      kind: 'add_friends',
      variant: 'suggestions',
      href: FRIENDS_HREF,
      people,
      // Rotate the headline by the day seed (Pool 4); eyebrow / CTA stay fixed.
      headlineIndex: daySeed,
    };
    return addFriendsPromoToStreamItem(embed, now, `add-friends-suggestions-${daySeed}`);
  }

  // No one to suggest — fall back to the invite nudge.
  const embed: Extract<StreamEmbed, { kind: 'add_friends'; variant: 'invite' }> = {
    kind: 'add_friends',
    variant: 'invite',
    href: FRIENDS_HREF,
    headlineIndex: daySeed,
  };
  return addFriendsPromoToStreamItem(embed, now, `add-friends-invite-${daySeed}`);
}
