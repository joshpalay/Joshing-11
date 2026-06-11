'use client'

import { useState } from 'react'

import { ActorLink, MilestoneExpansion } from '@/components/activity/ActivityStreamItem'
import { djb2 } from '@/lib/lately'

import { FeedCardShell } from './FeedCardShell'
import { visibleFeedCategory } from './category'
import type { FriendTerritoryCardModel, FriendTerritoryTopic } from './friend-territory'

// Territory triangles encode exactly TWO states — the viewer's "have I been
// here?" — on two independent axes: color = the topic's category, fill =
// play-state. Untried = hollow with the category-color border; played = filled
// solid, on attempt, right OR wrong identically. There is deliberately no
// third state and no wrong/error marker: a visually-legible miss on a shared
// social surface would reintroduce a scoreboard ("wrong answers are connection
// events"). NOTE: this polarity (filled = been here) is intentionally the
// card's own — the per-question marks inside the answer expansion keep the
// established solid=to-play / hollow=spent vocabulary (decision at the
// B-FRIEND-TERRITORY-CARD-01 checkpoint-1 gate).
//
// Category color hashes into the saturated triangle tokens only (same
// legibility restriction as ActivityIcon's star): the washed-out cream/tan
// tokens disappear as a 1.5px border on the cream card.
const TERRITORY_TRI_PALETTE = [
  'var(--tri-orange)', // #d15e36
  'var(--tri-darkteal)', // #6d837f
  'var(--tri-darkyellow)', // #deae5c
  'var(--tri-lightteal)', // #adb19e — sage
] as const

export function territoryTopicColor(topicName: string): string {
  return TERRITORY_TRI_PALETTE[djb2(topicName.toLowerCase()) % TERRITORY_TRI_PALETTE.length]!
}

// Geometry mirrors ActivityIcon's QuestionTriangle (11px, base = height). The
// hollow outline shrinks about the centroid so its outer stroke edge lands on
// the same footprint as the filled form, and fills render at the family's 80%
// opacity so the card stays calm.
const TRI_SIZE = 11
const HOLLOW_INSET = 0.84

function trianglePath(inset: number): string {
  const s = TRI_SIZE
  const cx = s / 2
  const cy = (2 * s) / 3
  const pts: Array<[number, number]> = [
    [s / 2, 0],
    [s, s],
    [0, s],
  ].map(([x, y]) => [cx + (x - cx) * inset, cy + (y - cy) * inset])
  return `M${pts[0]![0]} ${pts[0]![1]} L${pts[1]![0]} ${pts[1]![1]} L${pts[2]![0]} ${pts[2]![1]} Z`
}

export function TerritoryTriangle({ played, color }: { played: boolean; color: string }) {
  return (
    <svg
      width={TRI_SIZE}
      height={TRI_SIZE}
      viewBox={`0 0 ${TRI_SIZE} ${TRI_SIZE}`}
      aria-hidden="true"
      className="shrink-0"
      data-territory-state={played ? 'played' : 'untried'}
    >
      <path
        d={played ? trianglePath(1) : trianglePath(HOLLOW_INSET)}
        fill={played ? color : 'none'}
        fillOpacity={played ? 0.8 : undefined}
        stroke={played ? 'none' : color}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  )
}

// One in-session answer, mirroring ActivityStreamItem's resolution record so
// MilestoneExpansion's "Answered" history can echo what the viewer typed.
type Resolution = { submitted: string; isCorrect: boolean }

// A friend's knowledge portrait in the "From Friends" zone: name, a warm
// discovery-register status line, their recent territory (topic list with
// two-state triangles), and a forward CTA that opens the same inline answer
// flow the old milestone rows carried. The hero (first) card breathes more and
// shows one more topic; both fire the identical action, so the CTA copy is
// identical. No counts, no scores, no correctness anywhere on the card face.
export function FriendTerritoryCard({
  card,
  hero = false,
}: {
  card: FriendTerritoryCardModel
  hero?: boolean
}) {
  const [open, setOpen] = useState(false)
  // Questions the server already records as attempted (right OR wrong) lock on
  // load; in-session resolutions join them as the viewer plays, ticking the
  // topic triangles from hollow to filled live.
  const [serverAnswered] = useState<Set<string>>(
    () =>
      new Set(
        card.questions.filter((q) => q.priorResult !== null).map((q) => q.questionId),
      ),
  )
  const [resolutions, setResolutions] = useState<Map<string, Resolution>>(
    () => new Map(),
  )

  function isResolved(questionId: string): boolean {
    return serverAnswered.has(questionId) || resolutions.has(questionId)
  }

  function resolve(questionId: string, submitted: string, isCorrect: boolean) {
    setResolutions((prev) => {
      const next = new Map(prev)
      next.set(questionId, { submitted, isCorrect })
      return next
    })
  }

  // Fill is attempt-based and viewer-relative: the model's server-known state,
  // plus anything attempted this session — correctness never consulted.
  function topicPlayed(topic: FriendTerritoryTopic): boolean {
    if (topic.played) return true
    return card.questions.some(
      (q) =>
        visibleFeedCategory(q.domain) === topic.name && resolutions.has(q.questionId),
    )
  }

  const topicLimit = hero ? 4 : 3
  const shownTopics = card.topics.slice(0, topicLimit)
  const moreCount = card.topics.length - shownTopics.length

  return (
    <FeedCardShell elevated className={hero ? 'p-5' : 'p-4'}>
      <p
        className={`m-0 tracking-[0.2px] text-[var(--brand-ink)] ${
          hero ? 'text-[16px] leading-[1.5]' : 'text-[15px] leading-[1.5]'
        }`}
      >
        <ActorLink name={card.friendName} userId={card.friendId} />{' '}
        {card.statusLine}
      </p>

      {shownTopics.length > 0 ? (
        <ul className={`m-0 list-none p-0 ${hero ? 'mt-3 space-y-2' : 'mt-2.5 space-y-1.5'}`}>
          {shownTopics.map((topic) => (
            <li key={topic.name} className="flex items-center gap-2.5">
              <TerritoryTriangle
                played={topicPlayed(topic)}
                color={territoryTopicColor(topic.name)}
              />
              <span className="text-[14px] leading-[1.45] text-[var(--brand-ink-700)] [font-family:Georgia,serif]">
                {topic.name}
              </span>
            </li>
          ))}
          {moreCount > 0 ? (
            <li className="pl-[21.5px] text-[12px] text-[var(--brand-ink-400)]">
              +{moreCount} more
            </li>
          ) : null}
        </ul>
      ) : null}

      <div className={hero ? 'mt-4' : 'mt-3'}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-11 items-center text-[13px] font-medium tracking-[0.04em] text-[var(--brand-link)] underline underline-offset-4 transition hover:opacity-70"
        >
          Play these →
        </button>
      </div>

      {open ? (
        <div className="mt-1">
          <MilestoneExpansion
            expand={{
              kind: 'milestone',
              friendId: card.friendId,
              friendName: card.friendName,
              questions: card.questions,
            }}
            isResolved={isResolved}
            resolutions={resolutions}
            onResolved={resolve}
          />
        </div>
      ) : null}
    </FeedCardShell>
  )
}
