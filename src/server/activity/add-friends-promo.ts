/**
 * Homepage "add friends" promo.
 *
 * Produces a single, optional `StreamItem` (the inline add-friends embed) that
 * the home feed splices a few rows down. Two shapes, in priority order:
 *   1. `suggestions` — contact-match people the viewer can follow, each with an
 *      Add affordance. Shown whenever there's at least one addable match (it's
 *      genuinely actionable), so it isn't probabilistically gated.
 *   2. `invite` — when there are no addable matches, an occasional (~1 in 5)
 *      copy-only nudge toward /friends/find.
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
// The invite fallback reads as an occasional nudge, not a fixture.
const INVITE_SHOW_PROBABILITY = 0.2;
const FRIENDS_FIND_HREF = '/friends/find';

export async function getAddFriendsPromo(
  userId: string,
  now: Date = new Date(),
  // Injectable for tests; defaults to Math.random in [0, 1).
  random: () => number = Math.random,
): Promise<StreamItem | null> {
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

  // No one to suggest — fall back to the occasional invite nudge.
  if (random() >= INVITE_SHOW_PROBABILITY) return null;
  const embed: Extract<StreamEmbed, { kind: 'add_friends'; variant: 'invite' }> = {
    kind: 'add_friends',
    variant: 'invite',
    href: FRIENDS_FIND_HREF,
  };
  return addFriendsPromoToStreamItem(embed, now, `add-friends-invite-${daySeed}`);
}
