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
 *      /friends/find.
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
// Show on ~1 in 5 home visits so the promo reads as an occasional nudge, not a
// fixture — the same stateless gating as the common-ground promo.
const PROMO_SHOW_PROBABILITY = 0.2;
const FRIENDS_FIND_HREF = '/friends/find';

export async function getAddFriendsPromo(
  userId: string,
  now: Date = new Date(),
  // Injectable for tests; defaults to Math.random in [0, 1).
  random: () => number = Math.random,
): Promise<StreamItem | null> {
  // Gate first so the visits we won't show the promo skip the contact read.
  if (random() >= PROMO_SHOW_PROBABILITY) return null;

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
      href: FRIENDS_FIND_HREF,
      people,
    };
    return addFriendsPromoToStreamItem(embed, now, `add-friends-suggestions-${daySeed}`);
  }

  // No one to suggest — fall back to the invite nudge.
  const embed: Extract<StreamEmbed, { kind: 'add_friends'; variant: 'invite' }> = {
    kind: 'add_friends',
    variant: 'invite',
    href: FRIENDS_FIND_HREF,
  };
  return addFriendsPromoToStreamItem(embed, now, `add-friends-invite-${daySeed}`);
}
