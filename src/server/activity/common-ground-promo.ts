/**
 * Homepage "What's happening" common-ground promo.
 *
 * Produces a single, optional `StreamItem` (the inline common-ground embed) that
 * the home feed prepends to its activity rows. This is a HOME-ONLY surface — it
 * is assembled here, NOT inside buildActivityStream, so /activities and Lately
 * stay free of the promo.
 *
 * "Rotating discovery": we rotate the viewer's friends by a day seed and probe
 * the first few for LATENT common ground (domains both hold but at least one
 * hasn't proven — shared, still untested), surfacing the first that has any.
 */

import {
  commonGroundPromoToStreamItem,
  type StreamEmbed,
  type StreamItem,
} from '@/lib/activity-stream';
import { getCommonGround } from '@/server/db/queries/common-ground';
import { getFriends } from '@/server/db/queries/friends';

// The editorial "Shared Ground" feature shows only the two strongest shared-but-
// untested areas, so the circles stay the hero artwork (more than two crowds the
// motif). See CommonGroundFeature.
const MAX_PROMO_DOMAINS = 2;
// Cap the per-render getCommonGround probes so the homepage stays cheap even for
// users with many friends; the rotation still cycles through everyone over time.
const MAX_CANDIDATES = 4;
// The promo should read as an occasional nudge, not a fixture — show it on only
// ~2 in 5 visits (roughly once every two to three times on the site). Gating is
// probabilistic (stateless) so it needs no per-user counter cookie or DB row.
const PROMO_SHOW_PROBABILITY = 0.4;

function firstName(displayName: string | null): string {
  const trimmed = (displayName ?? '').trim();
  if (!trimmed) return 'They';
  const [first] = trimmed.split(/\s+/);
  return first ?? trimmed;
}

// Stable within a UTC day so the rotating pick (and the row's React key) don't
// churn across re-renders, but advances day to day.
function daySeed(now: Date): number {
  return Math.floor(now.getTime() / 86_400_000);
}

export async function getCommonGroundPromo(
  userId: string,
  now: Date = new Date(),
  // Injectable for tests; defaults to Math.random in [0, 1).
  random: () => number = Math.random,
): Promise<StreamItem | null> {
  // Gate first so the visits we won't show the promo skip the friend and
  // common-ground reads entirely.
  if (random() >= PROMO_SHOW_PROBABILITY) return null;

  const friends = await getFriends(userId);
  if (friends.length === 0) return null;

  const seed = daySeed(now);
  const candidates = Array.from(
    { length: Math.min(friends.length, MAX_CANDIDATES) },
    (_, i) => friends[(i + seed) % friends.length],
  );

  const grounds = await Promise.all(
    candidates.map((friend) => getCommonGround(userId, friend.id)),
  );

  for (let i = 0; i < candidates.length; i++) {
    const friend = candidates[i];
    const latent = grounds[i].latent;
    if (latent.length === 0) continue;

    const domains = latent.slice(0, MAX_PROMO_DOMAINS).map((d) => ({
      label: d.canonical_subcategory,
      viewer: { points: d.viewer.mastery_points, tier: d.viewer.current_tier },
      friend: { points: d.friend.mastery_points, tier: d.friend.current_tier },
    }));

    const embed: Extract<StreamEmbed, { kind: 'common_ground' }> = {
      kind: 'common_ground',
      friendId: friend.id,
      friendFirstName: firstName(friend.displayName),
      friendHref: `/users/${friend.id}`,
      domains,
    };

    return commonGroundPromoToStreamItem(
      embed,
      now,
      `common-ground-promo-${friend.id}-${seed}`,
    );
  }

  return null;
}
