'use client';

import { Bookmark } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { EditorialCarousel } from '@/components/feed/EditorialCarousel';
import { EditorialFeature } from '@/components/feed/EditorialFeature';
import { colorForUser, initialsFor, isDarkColor } from '@/components/feed/visual';
import { AddFriendButton } from '@/components/friends/AddFriendButton';
import { expandingTerritoryAccent } from '@/components/knowledge/PortraitCircles';
import { circleDatasetMax, DomainCircleSvg } from '@/components/profile/common-ground-circles';
import type { StreamEmbed } from '@/lib/activity-stream';

// The "Shared Ground" circles render larger here than on the profile page — the
// motif is the hero artwork, so it should catch the eye before the copy.
const SHARED_GROUND_CIRCLE_SCALE = 1.35;

// Badge accents for the "Your World Is Expanding" territory rows are keyed by
// the row's domain via expandingTerritoryAccent — shared with the /knowledge
// "Recently Expanding" module, so a territory carries one hue on both surfaces.

// A faded decorative cluster of overlapping avatar circles for the
// "Grow Your Circle" invite state — purely decorative (aria-hidden, no
// initials, no buttons), softened into the sage wash.
const INVITE_CLUSTER_SEEDS = ['circle-a', 'circle-b', 'circle-c', 'circle-d'];

// Promo HEADLINE pools (D-FEED-GROUP3-01 Pool 4). Only the headline rotates —
// eyebrow, CTA, and supporting copy stay fixed (functional wayfinding). The
// rotation is by the embed's day-seeded `headlineIndex`, not an event hash, so
// a promo that recurs as the same type still varies day to day. `{friend}` in
// the common-ground pool is rendered as a link (see CommonGroundFeature).
const RECENTLY_EXPANDING_HEADLINES = [
  "The places you've been exploring lately.",
  "New ground you've been covering.",
  "Where your curiosity's been wandering.",
] as const;

const ADD_FRIENDS_HEADLINES = [
  'Know someone who belongs here?',
  'Who else should be in your circle?',
  'There’s room for the people who get you.',
] as const;

// Common-ground headlines split into the copy AROUND the friend link so the
// friend's name stays a link wherever it falls in the line.
const COMMON_GROUND_HEADLINES = [
  { before: 'You and ', after: ' keep finding one another here.' },
  { before: 'You and ', after: ' keep meeting in the same places.' },
  { before: 'The ground you and ', after: ' share.' },
] as const;

// The closing carousel slide isn't a friend — it nudges toward widening the
// circle — so the headline and CTA shift to match it instead of naming a friend.
const COMMON_GROUND_INVITE_HEADLINE = 'There’s more ground to share.';
const COMMON_GROUND_INVITE_HREF = '/friends/find';

function rotate<T>(pool: readonly T[], index: number | undefined): T {
  return pool[(index ?? 0) % pool.length]!;
}

/**
 * "Shared Ground" — the overlapping-circle motif as a full-bleed editorial
 * feature. A carousel with a slide per friend (each their strongest shared-but-
 * untested domain), so the viewer can rotate through a few of the people they
 * share ground with, plus a closing nudge to widen their circle.
 */
export function CommonGroundFeature({
  embed,
}: {
  embed: Extract<StreamEmbed, { kind: 'common_ground' }>;
}) {
  // One shared scale across every slide so circles are comparable friend to
  // friend, not re-normalized per slide.
  const datasetMax = circleDatasetMax(
    embed.friends.flatMap((f) => [f.domain.viewer.points, f.domain.friend.points]),
  );
  const count = embed.friends.length;
  const headline = rotate(COMMON_GROUND_HEADLINES, embed.headlineIndex);
  // The headline names the friend in the active carousel slide, so rotating the
  // carousel updates the copy with it. The trailing slide is the "invite" nudge
  // (index === count), not a friend, so headline + CTA swap to the invite copy.
  const [activeIndex, setActiveIndex] = useState(0);
  const onInviteSlide = activeIndex >= count;
  const activeFriend = embed.friends[Math.min(activeIndex, count - 1)];
  const friendFirstName = activeFriend?.friendFirstName ?? embed.friendFirstName;
  const friendHref = activeFriend?.friendHref ?? embed.friendHref;
  return (
    <EditorialFeature
      tone="parchment"
      eyebrow="Shared Ground"
      eyebrowIcon={<Bookmark size={13} strokeWidth={0} fill="currentColor" />}
      headline={
        onInviteSlide ? (
          COMMON_GROUND_INVITE_HEADLINE
        ) : (
          <>
            {headline.before}
            <Link
              href={friendHref}
              className="text-[var(--brand-ink)] underline-offset-4 hover:underline"
            >
              {friendFirstName}
            </Link>
            {headline.after}
          </>
        )
      }
      artwork={
        <EditorialCarousel
          ariaLabel="Friends you share ground with"
          onActiveIndexChange={setActiveIndex}
          slides={[
            ...embed.friends.map((f) => (
              <div key={f.friendId} className="flex flex-col gap-4">
                <DomainCircleSvg
                  viewerPoints={f.domain.viewer.points}
                  friendPoints={f.domain.friend.points}
                  viewerTier={f.domain.viewer.tier}
                  friendTier={f.domain.friend.tier}
                  datasetMax={datasetMax}
                  scale={SHARED_GROUND_CIRCLE_SCALE}
                  ariaLabel={`${f.domain.label}: shared with ${f.friendFirstName}, still untested`}
                />
                <span className="flex max-w-[150px] flex-col gap-0.5">
                  <Link
                    href={f.friendHref}
                    className="font-serif text-[15px] leading-snug font-semibold text-[var(--brand-ink)] no-underline hover:underline"
                  >
                    {f.friendFirstName}
                  </Link>
                  <span className="font-serif text-[13px] leading-snug text-[var(--brand-ink-400)]">
                    {f.domain.label}
                  </span>
                </span>
              </div>
            )),
            // Final slide: a gentle nudge to widen the circle. The personal-invite
            // modal isn't mounted on the home feed, so this routes to the Find
            // Friends hub (where the invite flows live).
            <Link
              key="invite"
              href={COMMON_GROUND_INVITE_HREF}
              className="flex flex-col gap-4 no-underline"
            >
              <span aria-hidden="true" className="flex h-[76px] items-center">
                {INVITE_CLUSTER_SEEDS.map((seed, i) => (
                  <span
                    key={seed}
                    className="size-12 rounded-full ring-4 ring-[var(--editorial-parchment)]"
                    style={{ background: colorForUser(seed), marginLeft: i === 0 ? 0 : -16 }}
                  />
                ))}
              </span>
              <span className="max-w-[150px] font-serif text-[14px] leading-snug text-[var(--brand-ink-700)]">
                Invite someone
              </span>
            </Link>,
          ]}
        />
      }
      supporting={`Shared ground with ${count} ${count === 1 ? 'friend' : 'friends'}`}
      cta={
        onInviteSlide
          ? { label: 'Find friends →', href: COMMON_GROUND_INVITE_HREF }
          : { label: 'Explore your overlap →', href: friendHref }
      }
    />
  );
}

/**
 * "Grow Your Circle" — either a few contact-match people the viewer can follow
 * inline (suggestions), or, when there's no one to suggest, a decorative invite
 * nudge toward /friends/find.
 */
export function GrowYourCircleFeature({
  embed,
}: {
  embed: Extract<StreamEmbed, { kind: 'add_friends' }>;
}) {
  const router = useRouter();
  return (
    <EditorialFeature
      tone="sage"
      eyebrow="Grow Your Circle"
      headline={rotate(ADD_FRIENDS_HEADLINES, embed.headlineIndex)}
      artwork={
        embed.variant === 'suggestions' ? (
          <div className="flex flex-col gap-3">
            {embed.people.map((p) => {
              const bg = p.avatarColor ?? colorForUser(p.id);
              return (
                <div key={p.id} className="flex items-center gap-3">
                  <Link
                    href={`/users/${p.id}`}
                    className="grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold no-underline"
                    style={{ background: bg, color: isDarkColor(bg) ? '#fff' : '#0a1f3d' }}
                  >
                    {initialsFor(p.displayName)}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/users/${p.id}`}
                      className="text-sm font-semibold text-[var(--brand-ink)] no-underline"
                    >
                      {p.displayName}
                    </Link>
                    {p.handle ? (
                      <span className="block text-xs leading-tight text-[var(--brand-ink-400)]">
                        @{p.handle}
                      </span>
                    ) : null}
                  </div>
                  <AddFriendButton
                    targetUserId={p.id}
                    targetDisplayName={p.displayName}
                    relationship={p.relationship}
                    onChange={() => router.refresh()}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div aria-hidden="true" className="flex items-center opacity-50">
            {INVITE_CLUSTER_SEEDS.map((seed, i) => (
              <span
                key={seed}
                className="size-12 rounded-full ring-4 ring-[var(--editorial-sage)]"
                style={{ background: colorForUser(seed), marginLeft: i === 0 ? 0 : -16 }}
              />
            ))}
          </div>
        )
      }
      cta={{ label: 'Find friends →', href: embed.href }}
    />
  );
}

/**
 * "Your World Is Expanding" — the viewer's fastest-growing territories as a
 * full-bleed editorial feature, with a link through to /knowledge.
 */
export function RecentlyExpandingFeature({
  embed,
}: {
  embed: Extract<StreamEmbed, { kind: 'recently_expanding' }>;
}) {
  return (
    <EditorialFeature
      tone="slate"
      eyebrow="Your World Is Expanding"
      headline={rotate(RECENTLY_EXPANDING_HEADLINES, embed.headlineIndex)}
      artwork={
        <div className="flex flex-col gap-3">
          {embed.domains.map((d) => {
            const accent = expandingTerritoryAccent(d.label);
            return (
              <div key={d.label} className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold text-[var(--brand-ink)]"
                  style={{ border: `1px solid ${accent.border}`, background: accent.fill }}
                >
                  {d.initial}
                </span>
                <div className="min-w-0">
                  <p className="font-serif text-sm leading-tight font-bold text-[var(--brand-ink)]">
                    {d.label}
                  </p>
                  {d.caption ? (
                    <p className="mt-0.5 text-xs leading-tight text-[var(--brand-ink-700)]">
                      {d.caption}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      }
      cta={{ label: 'See your knowledge →', href: embed.href }}
    />
  );
}
