'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { EditorialCarousel } from '@/components/feed/EditorialCarousel';
import { EditorialFeature } from '@/components/feed/EditorialFeature';
import { colorForUser, initialsFor, isDarkColor } from '@/components/feed/visual';
import { AddFriendButton } from '@/components/friends/AddFriendButton';
import { expandingTerritoryAccent } from '@/components/knowledge/PortraitCircles';
import { TopicSuggestionCarousel } from '@/components/knowledge/TopicSuggestionCarousel';
import { circleDatasetMax, DomainCircleSvg } from '@/components/profile/common-ground-circles';
import type { StreamEmbed } from '@/lib/activity-stream';
import type { NearbyTerritory } from '@/lib/daily/territory-model';
import { domainKey } from '@/lib/knowledge/domain-key';

// The "Overlap" circles render larger here than on the profile page — the
// motif is the hero artwork, so it should catch the eye before the copy.
const SHARED_GROUND_CIRCLE_SCALE = 1.35;

// Badge accents for the "Your World Is Expanding" territory rows are keyed by
// the row's domain via expandingTerritoryAccent — shared with the /knowledge
// "Recently Expanding" module, so a territory carries one hue on both surfaces.

// Decorative invite mark — translucent overlapping discs (the brand
// "shared ground" overlap motif) rather than hard-ringed avatar chips. Soft
// fills, NO stroke, so it reads the same on both the sage (Overlap) and
// terracotta (Find friends) grounds and matches the rest of the system's
// stroke-free language. Purely decorative (aria-hidden).
function InviteOverlapDiscs() {
  return (
    <span aria-hidden="true" className="flex items-center">
      <span className="size-14 rounded-full bg-[var(--brand-ink)] opacity-50" />
      <span className="-ml-6 size-14 rounded-full bg-[var(--cream)] opacity-60" />
      <span className="-ml-6 size-14 rounded-full bg-[var(--brand-link)] opacity-50" />
    </span>
  );
}

// Promo HEADLINE pools (D-FEED-GROUP3-01 Pool 4). Only the headline rotates —
// the CTA and supporting copy stay fixed (functional wayfinding). The
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

const ADD_TOPIC_HEADLINES = [
  'Something else you’d love to be asked about?',
  'What else should we ask you about?',
  'There’s more ground worth claiming.',
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
const COMMON_GROUND_INVITE_HREF = '/friends';

function rotate<T>(pool: readonly T[], index: number | undefined): T {
  return pool[(index ?? 0) % pool.length]!;
}

/**
 * "Overlap" — the overlapping-circle motif as a full-bleed editorial
 * feature. A carousel with a slide per friend (each showing their one or two
 * strongest shared-but-untested areas), so swiping moves between PEOPLE the
 * viewer shares ground with — never between areas — plus a closing nudge to
 * widen their circle.
 */
export function CommonGroundFeature({
  embed,
}: {
  embed: Extract<StreamEmbed, { kind: 'common_ground' }>;
}) {
  // One shared scale across every slide so circles are comparable friend to
  // friend, not re-normalized per slide.
  const datasetMax = circleDatasetMax(
    embed.friends.flatMap((f) =>
      f.domains.flatMap((d) => [d.viewer.points, d.friend.points]),
    ),
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
      tone="interlude-sage"
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
                {/* One or two shared areas side by side — each circle motif with
                    its area label underneath. The circles sit on a shared
                    fixed-height baseline row and the columns top-align, so both
                    the circles and the labels line up horizontally whatever the
                    circle heights or the label line counts (h-[76px] = the max
                    scaled circle diameter, MAX_DIAMETER * SHARED_GROUND_CIRCLE_SCALE). */}
                <div className="flex items-start gap-10">
                  {f.domains.map((d) => (
                    <span key={d.label} className="flex flex-col gap-2">
                      <span className="flex h-[76px] items-end">
                        <DomainCircleSvg
                          viewerPoints={d.viewer.points}
                          friendPoints={d.friend.points}
                          viewerTier={d.viewer.tier}
                          friendTier={d.friend.tier}
                          datasetMax={datasetMax}
                          scale={SHARED_GROUND_CIRCLE_SCALE}
                          ariaLabel={`${d.label}: shared with ${f.friendFirstName}, still untested`}
                        />
                      </span>
                      <span className="max-w-[150px] font-serif text-quiet leading-snug text-[var(--brand-ink-400)]">
                        {d.label}
                      </span>
                    </span>
                  ))}
                </div>
                <Link
                  href={f.friendHref}
                  className="max-w-[150px] font-serif text-[15px] leading-snug font-semibold text-[var(--brand-ink)] no-underline hover:underline"
                >
                  {f.friendFirstName}
                </Link>
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
              <span className="flex h-[76px] items-center">
                <InviteOverlapDiscs />
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
 * nudge toward /friends.
 */
export function GrowYourCircleFeature({
  embed,
}: {
  embed: Extract<StreamEmbed, { kind: 'add_friends' }>;
}) {
  const router = useRouter();
  return (
    <EditorialFeature
      tone="interlude-terracotta"
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
                    style={{ background: bg, color: isDarkColor(bg) ? '#fff' : 'var(--ink)' }}
                  >
                    {initialsFor(p.displayName)}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/users/${p.id}`}
                      className="text-sm font-semibold text-[var(--cream)] no-underline"
                    >
                      {p.displayName}
                    </Link>
                    {p.handle ? (
                      <span className="block text-xs leading-tight text-[var(--cream)]/70">
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
          <InviteOverlapDiscs />
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

/**
 * "Add a topic" — a few suggested topics the viewer can adopt by tapping a
 * circle, with a link through to the full manage surface.
 *
 * Lives IN the feed rather than pinned above it: as a fixed card above the feed
 * it pushed the real content down on every single visit (Josh, 2026-09-14).
 * As an interleaved promo it reads as an occasional interlude and scrolls away
 * like the rest of the feed. Adding flips the circle in place to its "Added" state
 * (TopicSuggestionCarousel owns that), and the supporting line carries the
 * confirmation plus an Undo for a mis-tap.
 */
export function AddATopicFeature({
  embed,
}: {
  embed: Extract<StreamEmbed, { kind: 'add_topic' }>;
}) {
  // `created` comes from the POST response: an idempotent re-add of a topic the
  // viewer already holds returns created:false, and Undo must not render there —
  // it would deactivate a pre-existing interest.
  const [added, setAdded] = useState<{ domain: string; created: boolean } | null>(null);
  const [addedKeys, setAddedKeys] = useState<ReadonlySet<string>>(new Set());
  const [undoing, setUndoing] = useState(false);

  const addSuggestion = async (territory: NearbyTerritory): Promise<boolean> => {
    try {
      const response = await fetch('/api/declared-interests', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: territory.domain,
          ...(territory.broadCategory ? { broadCategory: territory.broadCategory } : {}),
        }),
      });
      if (!response.ok) throw new Error('add failed');
      const body = (await response.json().catch(() => null)) as
        | { domain?: string; created?: boolean }
        | null;
      // Prefer the canonical domain the server persisted over our local label.
      const domain = typeof body?.domain === 'string' && body.domain ? body.domain : territory.domain;
      setAdded({ domain, created: body?.created === true });
      setAddedKeys((prev) => new Set(prev).add(domainKey(domain)));
      return true;
    } catch {
      // Leave the circle in place so the player can retry.
      return false;
    }
  };

  // Deactivates that one domain (not a full replace), so it can't clobber an
  // interest declared elsewhere meanwhile.
  const undoAdded = async () => {
    if (!added?.created || undoing) return;
    setUndoing(true);
    try {
      const response = await fetch('/api/declared-interests', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: added.domain }),
      });
      if (!response.ok) throw new Error('undo failed');
      setAddedKeys((prev) => {
        const next = new Set(prev);
        next.delete(domainKey(added.domain));
        return next;
      });
      setAdded(null);
    } catch {
      // Leave the confirmation up — the topic is still genuinely added.
    } finally {
      setUndoing(false);
    }
  };

  return (
    <EditorialFeature
      // An interlude tone, not a wash: this is a fourth home interlude, and the
      // interlude tones are what carry the Josefin-caps system voice on the
      // supporting line + CTA (B-HOME-INTERLUDE-TYPE-01). Sage keeps the topic
      // circles legible on a light ground — they're built for the cream card —
      // where the dark ink/terracotta grounds would fight them.
      tone="interlude-sage"
      headline={rotate(ADD_TOPIC_HEADLINES, embed.headlineIndex)}
      artwork={
        <TopicSuggestionCarousel
          suggestions={embed.suggestions}
          addedKeys={addedKeys}
          onAdd={addSuggestion}
        />
      }
      supporting={
        added ? (
          <>
            {added.created ? (
              <>Added &ldquo;{added.domain}&rdquo; — it&rsquo;ll show up in an upcoming round.</>
            ) : (
              <>&ldquo;{added.domain}&rdquo; is already in your topics.</>
            )}
            {added.created ? (
              <>
                {' '}
                <button
                  type="button"
                  className="underline transition hover:opacity-70 disabled:opacity-50"
                  onClick={() => void undoAdded()}
                  disabled={undoing}
                >
                  {undoing ? 'Undoing…' : 'Undo'}
                </button>
              </>
            ) : null}
          </>
        ) : undefined
      }
      cta={{ label: 'Add your own →', href: embed.href }}
    />
  );
}
