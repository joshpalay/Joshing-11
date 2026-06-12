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
  type CommonGroundPromoFriend,
  type StreamEmbed,
  type StreamItem,
} from '@/lib/activity-stream';
import { getCommonGround } from '@/server/db/queries/common-ground';
import { getFriends } from '@/server/db/queries/friends';

// The editorial "Shared Ground" carousel shows a slide per friend, so swiping
// rotates through PEOPLE the viewer shares ground with (not through areas). See
// CommonGroundFeature.
const MAX_PROMO_FRIENDS = 3;
// Each friend's slide shows their strongest shared-but-untested domains — at
// least one, and a second when they share more than one area. Two keeps the
// circle motif the hero without crowding the slide.
const MAX_DOMAINS_PER_FRIEND = 2;
// Cap the per-render getCommonGround probes so the homepage stays cheap even for
// users with many friends; the rotation still cycles through everyone over time.
const MAX_CANDIDATES = 4;

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
): Promise<StreamItem | null> {
  // First-class module: render deterministically whenever there's latent common
  // ground to surface (the data-existence guards below are the only gate).
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

  // Collect a few friends with latent ground (in day-rotated order), one slide
  // each, so the carousel tours the viewer's circle instead of a single person.
  const promoFriends: CommonGroundPromoFriend[] = [];
  for (let i = 0; i < candidates.length && promoFriends.length < MAX_PROMO_FRIENDS; i++) {
    const friend = candidates[i];
    const latent = grounds[i].latent;
    if (latent.length === 0) continue;

    // The friend's strongest shared-but-untested domains (up to two), strongest
    // first — latent is already sorted by combined mastery points.
    promoFriends.push({
      friendId: friend.id,
      friendFirstName: firstName(friend.displayName),
      friendHref: `/users/${friend.id}`,
      domains: latent.slice(0, MAX_DOMAINS_PER_FRIEND).map((d) => ({
        label: d.canonical_subcategory,
        viewer: { points: d.viewer.mastery_points, tier: d.viewer.current_tier },
        friend: { points: d.friend.mastery_points, tier: d.friend.current_tier },
      })),
    });
  }

  if (promoFriends.length === 0) return null;

  // The featured (first) friend drives the row's one-liner and headline.
  const featured = promoFriends[0];
  const embed: Extract<StreamEmbed, { kind: 'common_ground' }> = {
    kind: 'common_ground',
    friendId: featured.friendId,
    friendFirstName: featured.friendFirstName,
    friendHref: featured.friendHref,
    friends: promoFriends,
    // Rotate the headline by the day seed (Pool 4) so it doesn't always show
    // line 1; eyebrow / CTA stay fixed.
    headlineIndex: seed,
  };

  return commonGroundPromoToStreamItem(
    embed,
    now,
    `common-ground-promo-${featured.friendId}-${seed}`,
  );
}
