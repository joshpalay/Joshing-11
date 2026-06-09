'use client'

import { Bookmark } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { EditorialFeature } from '@/components/feed/EditorialFeature'
import { colorForUser, initialsFor, isDarkColor } from '@/components/feed/visual'
import { AddFriendButton } from '@/components/friends/AddFriendButton'
import { circleDatasetMax, DomainCircleSvg } from '@/components/profile/common-ground-circles'
import type { StreamEmbed } from '@/lib/activity-stream'

// The "Shared Ground" circles render larger here than on the profile page — the
// motif is the hero artwork, so it should catch the eye before the copy.
const SHARED_GROUND_CIRCLE_SCALE = 1.35

// Badge accents for the "Your World Is Expanding" territory rows — the
// reds / golds / blues from the /knowledge "Recently Expanding" module, trimmed
// to the three we ever render.
const EXPANDING_ROW_ACCENTS = [
  { border: '#c9564d', fill: 'rgba(201, 86, 77, 0.16)' },
  { border: '#a98a4c', fill: 'rgba(169, 138, 76, 0.14)' },
  { border: '#65a8bb', fill: 'rgba(101, 168, 187, 0.2)' },
] as const

// A faded decorative cluster of overlapping avatar circles for the
// "Grow Your Circle" invite state — purely decorative (aria-hidden, no
// initials, no buttons), softened into the sage wash.
const INVITE_CLUSTER_SEEDS = ['circle-a', 'circle-b', 'circle-c', 'circle-d']

/**
 * "Shared Ground" — the overlapping-circle motif as a full-bleed editorial
 * feature: the two strongest shared-but-untested domains the viewer holds with
 * a friend, with a link through to that friend.
 */
export function CommonGroundFeature({
  embed,
}: {
  embed: Extract<StreamEmbed, { kind: 'common_ground' }>
}) {
  const datasetMax = circleDatasetMax(
    embed.domains.flatMap((d) => [d.viewer.points, d.friend.points]),
  )
  const count = embed.domains.length
  return (
    <EditorialFeature
      tone="parchment"
      eyebrow="Shared Ground"
      eyebrowIcon={<Bookmark size={13} strokeWidth={0} fill="currentColor" />}
      headline={
        <>
          You and{' '}
          <Link
            href={embed.friendHref}
            className="text-[var(--brand-ink)] underline-offset-4 hover:underline"
          >
            {embed.friendFirstName}
          </Link>{' '}
          keep finding one another here.
        </>
      }
      artwork={
        <div className="flex flex-wrap items-end gap-x-12 gap-y-8">
          {embed.domains.map((d) => (
            <div key={d.label} className="flex flex-col gap-4">
              <DomainCircleSvg
                viewerPoints={d.viewer.points}
                friendPoints={d.friend.points}
                viewerTier={d.viewer.tier}
                friendTier={d.friend.tier}
                datasetMax={datasetMax}
                scale={SHARED_GROUND_CIRCLE_SCALE}
                ariaLabel={`${d.label}: shared with ${embed.friendFirstName}, still untested`}
              />
              <span className="max-w-[150px] font-serif text-[14px] leading-snug text-[var(--brand-ink-700)]">
                {d.label}
              </span>
            </div>
          ))}
        </div>
      }
      supporting={`${count} shared interest${count === 1 ? '' : 's'}`}
      cta={{ label: 'Explore your overlap →', href: embed.friendHref }}
    />
  )
}

/**
 * "Grow Your Circle" — either a few contact-match people the viewer can follow
 * inline (suggestions), or, when there's no one to suggest, a decorative invite
 * nudge toward /friends/find.
 */
export function GrowYourCircleFeature({
  embed,
}: {
  embed: Extract<StreamEmbed, { kind: 'add_friends' }>
}) {
  const router = useRouter()
  return (
    <EditorialFeature
      tone="sage"
      eyebrow="Grow Your Circle"
      headline="Know someone who belongs here?"
      artwork={
        embed.variant === 'suggestions' ? (
          <div className="flex flex-col gap-3">
            {embed.people.map((p) => {
              const bg = p.avatarColor ?? colorForUser(p.id)
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
              )
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
  )
}

/**
 * "Your World Is Expanding" — the viewer's fastest-growing territories as a
 * full-bleed editorial feature, with a link through to /knowledge.
 */
export function RecentlyExpandingFeature({
  embed,
}: {
  embed: Extract<StreamEmbed, { kind: 'recently_expanding' }>
}) {
  return (
    <EditorialFeature
      tone="slate"
      eyebrow="Your World Is Expanding"
      headline="The places you've been exploring lately."
      artwork={
        <div className="flex flex-col gap-3">
          {embed.domains.map((d, i) => {
            const accent = EXPANDING_ROW_ACCENTS[i % EXPANDING_ROW_ACCENTS.length]!
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
                  <p className="font-serif text-sm font-bold leading-tight text-[var(--brand-ink)]">
                    {d.label}
                  </p>
                  {d.caption ? (
                    <p className="mt-0.5 text-xs leading-tight text-[var(--brand-ink-700)]">
                      {d.caption}
                    </p>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      }
      cta={{ label: 'See your knowledge →', href: embed.href }}
    />
  )
}
