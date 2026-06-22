'use client'

import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AnsweredByYouCard,
  DirectSentCard,
  DismissedFeedBar,
  FeedCardSwipe,
  FeedOverflowMenu,
  FriendAddedCard,
  FriendLikedCard,
  ViaAttribution,
  DiscoveryAttribution,
  visibleFeedCategory,
  type AnsweredByYouFeedItem,
  type DirectSentFeedItem,
  type FeedRecheckAction,
  type FriendAddedFeedItem,
  type FriendLikedFeedItem,
  type ViaAnswerer,
  type DiscoveryPerson,
} from '@/components/feed'
import { usePrefersReducedMotion } from '@/components/feed/usePrefersReducedMotion'
import { SpeechBubbleIllustration } from '@/components/home/FeedEmptyArt'
import { formatRelativeTime, groupItemsByRecency } from '@/components/feed/visual'
import { pickOpenedNewTerritory, pickOpenedTerritoryDomain } from '@/components/feed/territory'
import { ActivityStreamItem } from '@/components/activity/ActivityStreamItem'
import { FromFriendsStreak } from '@/components/feed/FromFriendsStreak'
import { PersonActivityCard } from '@/components/activity/PersonActivityCard'
import { groupActivityByFriend, type GroupInputRow, type GroupedRow } from '@/components/feed/person-grouping'
import { EditorialFeature } from '@/components/feed/EditorialFeature'
import {
  CommonGroundFeature,
  GrowYourCircleFeature,
  RecentlyExpandingFeature,
} from '@/components/feed/EditorialPromos'
import type { StreamItem } from '@/lib/activity-stream'
import type { InsideJokeKind, QuestionSource } from '@/lib/questions-types'
import {
  ANSWER_GRADER_RETRY_MESSAGE,
  submitAnswerWithRetry,
} from '@/lib/answer-submit'

// Both answer sheets are bottom-of-tree modals gated by component state: the
// answer sheet only mounts when a card is tapped, and the feedback sheet only
// after a grade returns (its chunk loads in parallel during the grading
// round-trip, so the split adds no perceived latency). Code-splitting them keeps
// their subtrees — AnswerFeedbackSheet alone pulls ReportReasonSheet,
// NewTerritoryUndo and lucide icons — out of the initial JS shipped to home,
// /for-you and /from-friends. ssr:false is safe: neither ever renders during SSR.
const AnswerSheet = dynamic(
  () => import('@/components/feed/AnswerSheet').then((m) => m.AnswerSheet),
  { ssr: false },
)
const AnswerFeedbackSheet = dynamic(
  () => import('@/components/feed/AnswerFeedbackSheet').then((m) => m.AnswerFeedbackSheet),
  { ssr: false },
)

type FriendResult = {
  userId: string
  displayName: string
  result: 'correct' | 'incorrect' | null
}

type FeedApiItem = {
  id: string
  kind: 'question'
  question_id: string | null
  card_type:
    | 'direct_sent'
    | 'friend_added'
    | 'friend_liked'
    | 'answered_by_you'
  source_type: string
  source_user_id: string
  source_friend_display_name: string
  source_profile_href?: string | null
  source_attribution: string
  // Fields the server omits when null (see compactNulls in get-feed-page.ts).
  // Optional + nullable here because the client also constructs FeedApiItem
  // values locally (after answer submit) and sometimes writes null explicitly.
  source_result?: 'correct' | 'incorrect' | null
  friend_results?: FriendResult[] | null
  // B-VIA-ATTRIBUTION-01: follow-gated, recency-ordered friend-answerer set for
  // this question (lead-first). Server-emitted; absent when no friend answered.
  // A distinct field from friend_results (which the answered-card comparison
  // copy reads) so the two can't collide.
  via_answerers?: ViaAnswerer[] | null
  // D-4 via-attribution: gated stranger-discovery affordances. discovery_author
  // = the human who wrote the question; discovery_via = the relay source it
  // reached the viewer through (two hops up). Independent — both, either, or
  // neither present. Server-gated (stranger-only, opt-in, public questions).
  discovery_author?: DiscoveryPerson | null
  discovery_via?: DiscoveryPerson | null
  viewer_answer_status?: { result: 'correct' | 'incorrect' } | null
  endorsement_count?: number | null
  additional_endorsers?: Array<{ userId: string; displayName: string }> | null
  source_event_at: string
  personal_message?: string | null
  state: string
  is_pinned: boolean
  question_text?: string | null
  // B-6: provenance of the underlying question, used to pick the recipient-facing
  // verb ("wrote you this" for human-authored vs "sent you this" for curated LLM).
  // Derived from the canonical QuestionSource (D-3 added 'house_authored') so this
  // can't drift out of sync with the server emitter again — a hand-written literal
  // here was the B-9 regression (typecheck broke when 'house_authored' was added).
  question_source?: QuestionSource | null
  is_in_bank: boolean
  domain_pill?: string | null
  broad_category?: string | null
  explanation?: string | null
  answer_result?: 'correct' | 'incorrect' | null
  is_correct?: boolean | null
  correct_answer?: string | null
  submitted_answer?: string | null
  awarded_points?: number | null
  mastery_delta?: unknown | null
  viewer_is_author?: boolean
}

type FeedMeta = {
  has_friends: boolean
  has_dismissed_domains: boolean
  total_item_count: number
  active_item_count: number
  pre_filter_active_count: number
  broadcasts_item_count: number
  sent_item_count: number
  page_item_count?: number
  limit?: number
  cursor?: string | null
  next_cursor?: string | null
  has_more?: boolean
  filter?: FeedFilter
}

type FeedFilter = 'all' | 'sent-to-me' | 'from-friends'

type FeedResponse = {
  viewer_user_id: string
  meta?: FeedMeta
  next_cursor?: string | null
  has_more?: boolean
  items: FeedApiItem[]
}

type AnswerResponse = {
  isCorrect?: boolean
  correctAnswer?: string
  explanation?: string | null
  creatorNote?: string | null
  insideJoke?: string | null
  insideJokeKind?: InsideJokeKind | null
  authorName?: string | null
  authorIsHouse?: boolean
  pointsAwarded?: number | null
  masteryDelta?: unknown | null
  unverified?: boolean
}

type ResultState = {
  correct: boolean
  answer: string
  submittedAnswer: string
  explanation: string | null
  creatorNote: string | null
  insideJoke: string | null
  insideJokeKind: InsideJokeKind | null
  authorName: string | null
  authorIsHouse: boolean
  awardedPoints: number | null
  masteryDelta: unknown | null
  unverified: boolean
}

function formatEventTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function profileHref(userId?: string | null) {
  return userId ? `/users/${encodeURIComponent(userId)}` : null
}

/**
 * PRD §8.2.10 — transient confirmation line that replaces a feed card after
 * a thumbs-down (or its undo). Auto-dismisses on a 4s timer set by the
 * caller; tap-to-dismiss-early is wired to onDismiss.
 */
function ThumbsdownConfirmRow({
  phase,
  onDismiss,
  onUndo,
  disabled,
}: {
  phase: 'removed' | 'restored'
  onDismiss: () => void
  onUndo: () => void
  disabled?: boolean
}) {
  const message =
    phase === 'removed'
      ? "Removed from your feed. Won't pass to your friends."
      : 'Restored. This may pass to your friends.'
  return (
    <div
      role="status"
      aria-live="polite"
      onClick={onDismiss}
      className="text-muted-foreground flex items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2 text-sm italic"
    >
      <span>{message}</span>
      {phase === 'removed' ? (
        <button
          type="button"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation()
            onUndo()
          }}
          className="text-foreground text-xs font-medium underline-offset-4 hover:underline disabled:opacity-50"
        >
          Undo
        </button>
      ) : null}
    </div>
  )
}

function FeedPersonLink({
  href,
  name,
}: {
  href?: string | null
  name: string
}) {
  if (!href) return <>{name}</>
  return (
    <Link
      href={href}
      className="font-semibold text-[var(--brand-ink)] underline decoration-[var(--brand-rule)] underline-offset-2 hover:decoration-[var(--brand-ink)]"
    >
      {name}
    </Link>
  )
}

function comparisonCopy(
  playerCorrect: boolean | null,
  friendResults: FriendResult[] | null,
  sourceType?: string,
  sourceFriendName?: string,
  sourceUserId?: string | null
): ReactNode {
  const primaryFriend = friendResults?.[0]
  const friendIsAuthor =
    !primaryFriend &&
    (sourceType === 'direct_sent' || sourceType === 'authored_shared')
  const friendName =
    primaryFriend?.displayName ?? sourceFriendName ?? 'They'
  const friendUserId = primaryFriend?.userId ?? sourceUserId ?? null
  const friendNode = (
    <FeedPersonLink href={profileHref(friendUserId)} name={friendName} />
  )
  const friendCorrect = primaryFriend?.result === 'correct'

  if (playerCorrect === null) return 'You have already answered this question.'
  if (friendIsAuthor) {
    if (playerCorrect)
      return <>You and {friendNode} have that in common.</>
    return <>{friendNode} knows this one. You might next time.</>
  }
  if (playerCorrect && friendCorrect)
    return <>You and {friendNode} share this knowledge.</>
  if (playerCorrect && !friendCorrect)
    return <>You found a connection {friendNode} missed.</>
  if (!playerCorrect && friendCorrect)
    return <>{friendNode} has knowledge to share. You might next time.</>
  return 'This one is still waiting for common ground.'
}

// B-6: the recipient-facing verb. For a direct send, the verb is keyed off the
// underlying question's provenance, NOT the send mechanism: a human-authored
// question reads "wrote you this"; a curated LLM forward reads "sent you this".
// Only an explicit 'authored' source yields the human-authorship verb — any other
// or absent provenance defaults to the curated verb, so a curated/LLM send can
// never imply a human wrote it (B-5).
export function feedSourceVerb(
  sourceType: string,
  questionSource: FeedApiItem['question_source'],
): string {
  if (sourceType === 'direct_sent') {
    return questionSource === 'authored' ? 'wrote you this' : 'sent you this'
  }
  if (sourceType === 'authored_shared') return 'wrote this'
  if (sourceType === 'thumbs_upped') return 'liked this'
  return 'answered this'
}

function feedMetadata(item: FeedApiItem, answered = false) {
  const time = formatEventTime(item.source_event_at)
  const source = (
    <span>
      <FeedPersonLink
        href={item.source_profile_href ?? profileHref(item.source_user_id)}
        name={item.source_friend_display_name}
      />{' '}
      {feedSourceVerb(item.source_type, item.question_source)}
    </span>
  )

  return (
    <span>
      {source}
      {time ? <> · {time}</> : null}
      {answered ? <> · You answered</> : null}
    </span>
  )
}

// `hideTimestamp` blanks the relative "1d ago" on the home "What's Happening"
// feed (unifiedHome), so its question cards match the timestamp-free activity
// rows; the Broadcasts/Sent surfaces leave it on.
function baseTypedFields(item: FeedApiItem, answered = false, hideTimestamp = false) {
  return {
    id: item.id,
    metadata: feedMetadata(item, answered),
    category: item.domain_pill,
    broadCategory: item.broad_category ?? null,
    question: item.question_text ?? 'Untitled question',
    personalMessage: item.personal_message,
    isInBank: item.is_in_bank,
    avatarName: item.source_friend_display_name,
    avatarUserId: item.source_user_id,
    authorHref: item.source_profile_href ?? profileHref(item.source_user_id),
    timestamp: hideTimestamp ? '' : formatRelativeTime(item.source_event_at),
    viewerIsAuthor: item.viewer_is_author === true,
  }
}

function toTypedFeedItem(item: FeedApiItem, hideTimestamp = false) {
  const base = baseTypedFields(item, false, hideTimestamp)

  if (item.card_type === 'direct_sent') {
    return {
      ...base,
      type: 'direct_sent' as const,
      senderName: item.source_friend_display_name,
      senderHref: item.source_profile_href ?? profileHref(item.source_user_id),
      authoredBySender: item.question_source === 'authored',
    } satisfies DirectSentFeedItem
  }

  if (item.card_type === 'friend_liked') {
    return {
      ...base,
      type: 'friend_liked' as const,
      friendName: item.source_friend_display_name,
      friendHref: item.source_profile_href ?? profileHref(item.source_user_id),
      endorsementCount: item.endorsement_count,
      additionalEndorsers: item.additional_endorsers,
    } satisfies FriendLikedFeedItem
  }

  // D-1 Stage 5: friend_answered is no longer a feed card. friend_added (the
  // authored_shared broadcast envelope) is the default, and the safe fallback
  // for any unexpected card_type.
  return {
    ...base,
    type: 'friend_added' as const,
    friendName: item.source_friend_display_name,
    friendHref: item.source_profile_href ?? profileHref(item.source_user_id),
  } satisfies FriendAddedFeedItem
}

function normalizeMasteryDelta(
  raw: unknown
): AnsweredByYouFeedItem['masteryDelta'] {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const previousTier = typeof r.previousTier === 'string' ? r.previousTier : null
  const newTier = typeof r.newTier === 'string' ? r.newTier : null
  if (!previousTier || !newTier) return null
  const tierChanged =
    typeof r.tierChanged === 'boolean' ? r.tierChanged : previousTier !== newTier
  return { previousTier, newTier, tierChanged }
}

function pickBroadCategory(
  raw: unknown,
  item: FeedApiItem
): string | null {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    if (typeof r.broadCategory === 'string' && r.broadCategory.length > 0) {
      return r.broadCategory
    }
  }
  return item.broad_category ?? null
}

function pickPairedFriend(
  item: FeedApiItem
): { displayName: string; userId: string | null } | null {
  const primary = item.friend_results?.[0]
  if (primary?.displayName) {
    return { displayName: primary.displayName, userId: primary.userId ?? null }
  }
  if (
    item.source_type === 'direct_sent' ||
    item.source_type === 'authored_shared'
  ) {
    if (item.source_friend_display_name) {
      return {
        displayName: item.source_friend_display_name,
        userId: item.source_user_id ?? null,
      }
    }
  }
  return null
}

function toAnsweredByYouItem(
  item: FeedApiItem,
  result?: ResultState,
  hideTimestamp = false
): AnsweredByYouFeedItem {
  const masteryDeltaRaw = result?.masteryDelta ?? item.mastery_delta
  return {
    ...baseTypedFields(item, true, hideTimestamp),
    avatarName: null,
    avatarUserId: null,
    type: 'answered_by_you',
    resultLabel:
      item.is_correct === false || result?.correct === false
        ? 'Reviewed privately'
        : 'You answered',
    answerSummary: result
      ? comparisonCopy(
          result.correct,
          item.friend_results ?? null,
          item.source_type,
          item.source_friend_display_name,
          item.source_user_id
        )
      : comparisonCopy(
          item.is_correct ?? null,
          item.friend_results ?? null,
          item.source_type,
          item.source_friend_display_name,
          item.source_user_id
        ),
    correctAnswer: result?.answer || item.correct_answer,
    submittedAnswer: item.submitted_answer || undefined,
    isCorrect: result?.correct ?? item.is_correct,
    awardedPoints: result?.awardedPoints ?? item.awarded_points,
    explanation: result?.explanation ?? item.explanation,
    creatorNote: result?.creatorNote ?? null,
    authorName: result?.authorName ?? null,
    authorIsHouse: result?.authorIsHouse ?? false,
    broadCategory: pickBroadCategory(masteryDeltaRaw, item),
    masteryDelta: normalizeMasteryDelta(masteryDeltaRaw),
    pairedFriend: pickPairedFriend(item),
  }
}

type FeedListProps = {
  pageSize?: number
  infinite?: boolean
  /**
   * Server-rendered first page. When supplied, the initial client fetch is
   * skipped — items, cursor, and meta are seeded from this prop so the user
   * sees the feed on first paint with no client round-trip. Subsequent filter
   * changes and infinite-scroll pages still fetch via /api/feed.
   */
  initialPage?: FeedResponse | null
  /**
   * When true, render the contribute footer (Invite a friend · Write a question)
   * pinned to the bottom of the feed surface on both tabs. Enabled from the
   * authenticated home render; left off for the logged-out feed.
   */
  showContributeFooter?: boolean
  /**
   * The unified-home "What's Happening" surface. When set, the activity stream
   * (Lately) is interleaved chronologically into the question feed, the surface
   * tabs are hidden, and the feed filter is pinned to 'all' so directly-sent
   * questions thread in. See `activityItems`.
   */
  unifiedHome?: boolean
  /**
   * The full activity/Lately stream to interleave when `unifiedHome` is set.
   * Each StreamItem renders via <ActivityStreamItem>; a received_direct_question
   * row is de-duped against its richer direct_sent feed card (see unifiedRows).
   */
  activityItems?: StreamItem[]
  /**
   * Home-only "Overlap" common-ground promo (the overlapping-circle
   * editorial feature). A first-class module: rendered whenever there's latent
   * shared ground to surface, spliced a couple rows down so it's never the very
   * first feed item when there's other activity (it falls to row 0 only on an
   * empty feed). Null when the viewer has no shared ground. See displayRows.
   */
  commonGroundPromo?: StreamItem | null
  /**
   * Home-only "Your world is expanding" promo. A first-class module anchored to
   * the feed tail — rendered whenever the viewer has expanding territories. Null
   * otherwise. See getRecentlyExpandingPromo / displayRows.
   */
  expandingPromo?: StreamItem | null
  /**
   * Home-only "add friends" promo (contact-match suggestions, or an invite
   * nudge). A first-class module anchored to the feed tail next to the expanding
   * promo. See getAddFriendsPromo / displayRows.
   */
  addFriendsPromo?: StreamItem | null
  /**
   * B-HOME-OVERFLOW-02: the /for-you overflow subpage. Renders the FULL pending
   * direct queue (server-seeded via initialPage, in the same sender-rotated
   * order Home windows) as a flat answerable list: filter pinned to 'all',
   * surface tabs hidden, no recency buckets, no section headings, server order
   * preserved. Cards keep the home-zone treatment (elevated, timestamp-free)
   * and the full existing answer flow. After a successful answer the client
   * router cache is refreshed so Home recomputes its top-N on return (§7).
   */
  pendingQueue?: boolean
  /**
   * D-HOME-PACING-01: the server-computed budget for the unified home edition.
   * When supplied, FeedList renders a FIXED-BUDGET view rather than the unbounded
   * stream: the served direct/playable slices it was handed are shown with a
   * quiet "N more →" overflow affordance per question zone, the temporal recency
   * buckets are dropped (§4), exactly one rotating panel renders (§2), and the
   * all-empty switch (§9) is driven by `isAllEmpty`. Selection happens entirely
   * server-side; this prop carries only the counts and the chosen panel.
   */
  budget?: HomeBudget | null
}

export type HomeBudget = {
  /** Direct ("For You") questions pending beyond the served slice. */
  directOverflowCount: number
  /** Playable friend-activity bundles pending beyond the served slice. */
  playablesOverflowCount: number
  /** The single mid-feed panel (Overlap) for this load, or null on the all-empty page. */
  panel: StreamItem | null
  /**
   * The always-on "Find friends" (Grow Your Circle) interlude, rendered at the
   * feed tail directly above the Write composer. Independent of `panel`.
   */
  growCircle?: StreamItem | null
  /** True when all three content zones are empty — drives the empty switch. */
  isAllEmpty: boolean
  /**
   * Per-section "this Zone-2 section is empty in-window" signal (emitted by
   * `selectHomeEdition`). Originally drove the honest per-section empty states
   * of D-HOME-DASHBOARD-MODEL-01 point 4; that treatment was reverted on
   * 2026-06-15 — empty Zone-2 sections are now hidden outright — so the
   * renderer no longer reads this. Retained as part of the server edition
   * contract (and to make the per-section treatment trivial to re-enable).
   */
  emptySections?: {
    fromFriends: boolean
    texture: boolean
    sharedGround: boolean
  }
}

type QuestionCardState = 'unanswered' | 'answered'

// One row of the unified-home feed: either a paginated question card or an
// interleaved activity (Lately) one-liner. Both carry `source_event_at` so the
// existing recency grouping works over the merged list unchanged. The per-person
// grouping helpers live in ./feed/person-grouping (pure + unit-tested).
type UnifiedRow = GroupInputRow<FeedApiItem>

// D-HOME-PACING-01 §2 (tuned 2026-06-12): on the budgeted home, the texture
// zone runs this many rows, then the rotating panel as a mid-zone interlude,
// then the remaining rows (the server caps the set at TEXTURE_SOFT_CAP = 8),
// closed by the "See more activity →" row.
const TEXTURE_LEAD_COUNT = 3

// Wrap a promo/panel StreamItem as an activity row so the single rotating panel
// renders through the shared renderRow path (D-HOME-PACING-01 §2 slot 5).
function panelRow(item: StreamItem): UnifiedRow {
  const sortAt = item.sortAt instanceof Date ? item.sortAt : new Date(item.sortAt)
  return {
    kind: 'activity',
    item,
    source_event_at: sortAt.toISOString(),
    sortMs: sortAt.getTime(),
  }
}

// The quiet "N more →" overflow affordance under a budgeted question zone (§3).
// Plain by design — it states the abundance ("6 more waiting for you," never
// "6 unanswered") and opens that zone's overflow subpage (B-HOME-OVERFLOW-02).
function OverflowRow({
  unifiedHome,
  label,
  href,
}: {
  unifiedHome: boolean
  label: string
  href: string
}) {
  return (
    <Link
      href={href}
      className={`flex min-h-11 items-center pt-1 text-[13px] font-medium tracking-[0.04em] text-[var(--brand-link)] ${
        unifiedHome ? 'pl-0.5' : ''
      }`}
    >
      {label}
    </Link>
  )
}

export default function FeedList(props: FeedListProps) {
  return (
    <Suspense fallback={<FeedListLoading />}>
      <FeedListContent {...props} />
    </Suspense>
  )
}

function FeedListLoading() {
  return (
    <div className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
      Loading feed…
    </div>
  )
}

// D-1 Stage 5: the feed is exactly two surfaces. Broadcasts is the friend-sourced
// stream (authored questions + legacy likes); Sent is questions addressed to you.
const FEED_SURFACE_TABS: ReadonlyArray<{
  filter: Exclude<FeedFilter, 'all'>
  label: string
  count: (meta: FeedMeta | null) => number
}> = [
  { filter: 'from-friends', label: 'Broadcasts', count: (meta) => meta?.broadcasts_item_count ?? 0 },
  { filter: 'sent-to-me', label: 'Sent', count: (meta) => meta?.sent_item_count ?? 0 },
]

function FeedSurfaceTabs({
  active,
  meta,
  onSelect,
}: {
  active: FeedFilter
  meta: FeedMeta | null
  onSelect: (filter: FeedFilter) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Feed surfaces"
      className="mb-3 flex border-b"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
        event.preventDefault()
        const index = FEED_SURFACE_TABS.findIndex((tab) => tab.filter === active)
        const delta = event.key === 'ArrowRight' ? 1 : -1
        const next =
          FEED_SURFACE_TABS[
            (index + delta + FEED_SURFACE_TABS.length) % FEED_SURFACE_TABS.length
          ]
        onSelect(next.filter)
      }}
    >
      {FEED_SURFACE_TABS.map((tab) => {
        const selected = tab.filter === active
        const count = tab.count(meta)
        return (
          <button
            key={tab.filter}
            type="button"
            role="tab"
            id={`feed-tab-${tab.filter}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
              selected
                ? 'border-foreground text-foreground border-b-2'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => onSelect(tab.filter)}
          >
            {tab.label}
            {count > 0 ? (
              <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-xs leading-none">
                {count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

// The bottom-of-feed prompt: instead of a passive "two ways to fill your feed"
// footer, ask the reader what they actually want to be asked and hand their idea
// straight to the question writer. The typed idea rides through as ?text= so the
// composer opens pre-filled (see app/questions/page.tsx). "Invite a friend"
// survives as a secondary link so we don't lose that path.
// The reader's typed idea rides to the composer via ?text=; an empty box still
// opens the writer. When an idea is supplied the reader has effectively already
// "written" the question here, so we also pass &submit=1: the composer runs the
// review + answer suggestion and saves it without a second Save click (see
// QuestionForm's autoSubmit). An empty box opens the writer to fill in manually.
// Pure so the branches stay test-covered without a DOM.
export function buildQuestionWriterHref(idea: string): string {
  const trimmed = idea.trim()
  return trimmed
    ? `/questions?create=1&intent=bank&text=${encodeURIComponent(trimmed)}&submit=1`
    : '/questions?create=1&intent=bank'
}

// Example questions the composer placeholder cycles through, one every few
// seconds, so the prompt keeps suggesting the kind of thing worth asking.
const CONTRIBUTE_PLACEHOLDER_EXAMPLES = [
  'Who was the main character in Catch 22?',
  'Who starred in the Tim Burton Batman films?',
  'Who was the 16th president of the United States?',
] as const

const CONTRIBUTE_PLACEHOLDER_INTERVAL_MS = 4000
// Crossfade timings for the cycling placeholder. Kept long and asymmetric so
// the rotation reads as a graceful dissolve rather than a hard swap: the old
// line eases out, then the new one eases in over a longer beat.
const CONTRIBUTE_PLACEHOLDER_FADE_OUT_MS = 600
const CONTRIBUTE_PLACEHOLDER_FADE_IN_MS = 900

function FeedContributeFooter() {
  const router = useRouter()
  const [idea, setIdea] = useState('')
  const [placeholderIndex, setPlaceholderIndex] = useState(0)
  // Drives the opacity crossfade. We can't animate a native <textarea>
  // placeholder, so the placeholder is an overlaid element (below) whose
  // opacity we toggle: fade out, swap the text while hidden, fade back in.
  const [placeholderVisible, setPlaceholderVisible] = useState(true)

  // Circulate the placeholder through the example questions every few seconds.
  useEffect(() => {
    const timer = setInterval(() => {
      setPlaceholderVisible(false) // ease the current line out
      window.setTimeout(() => {
        setPlaceholderIndex((index) => (index + 1) % CONTRIBUTE_PLACEHOLDER_EXAMPLES.length)
        setPlaceholderVisible(true) // ease the next line in
      }, CONTRIBUTE_PLACEHOLDER_FADE_OUT_MS)
    }, CONTRIBUTE_PLACEHOLDER_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    router.push(buildQuestionWriterHref(idea))
  }

  return (
    // Add-a-Question prompt — now composes the shared EditorialFeature so it
    // reads as one family with the feed's other invitation blocks (parchment
    // wash, serif prompt) instead of re-rolling its own chrome. As the feed's
    // closing band it sets `bleedBottom` so the navy wash runs to the bottom of
    // the scroll (under the fixed nav) rather than stopping short and leaving an
    // orphaned strip of page cream — so the footer carries no bottom padding of
    // its own. EditorialFeature self-manages its own -mx-4 bleed, so there's no
    // horizontal margin to double up. The composer is the "artwork" and the
    // submit button rides inside its <form> (so it still submits) — the box
    // stays an input: the reader's typed idea rides to the writer via ?text=
    // (buildQuestionWriterHref).
    <footer>
      <EditorialFeature
        tone="interlude-ink"
        bleedBottom
        headline="Sometimes the best way to show you know someone is to ask them a question."
        artwork={
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Wrapper lets the fading placeholder overlay sit exactly over
                the textarea. The overlay (not the native placeholder) is what
                cycles, so we can crossfade it; it shows only while empty and
                is hidden from AT (the textarea keeps the aria-label). */}
            <div className="relative">
              <textarea
                value={idea}
                onChange={(event) => setIdea(event.target.value)}
                aria-label="What question would you like to be asked?"
                rows={5}
                className="min-h-[180px] w-full resize-none rounded-[var(--radius-md)] border border-[var(--cream-accent)] bg-[var(--brand-field)] px-4 py-3 text-base text-[var(--brand-ink)] outline-none focus:border-[var(--brand-navy)]"
              />
              {idea.trim() === '' ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 px-4 py-3 text-base text-[var(--brand-ink-400)]"
                  style={{
                    opacity: placeholderVisible ? 1 : 0,
                    transition: `opacity ${
                      placeholderVisible
                        ? CONTRIBUTE_PLACEHOLDER_FADE_IN_MS
                        : CONTRIBUTE_PLACEHOLDER_FADE_OUT_MS
                    }ms ease-in-out`,
                  }}
                >
                  {CONTRIBUTE_PLACEHOLDER_EXAMPLES[placeholderIndex]}
                </span>
              ) : null}
            </div>
            {/* On the dark navy interlude ground the button is a gold fill /
                ink label, and the label takes the Josefin caps system voice
                (uppercase + letterspacing). */}
            <button
              type="submit"
              className="inline-flex min-h-12 w-full items-center justify-center rounded-[var(--radius-card)] bg-[var(--accent-gold)] px-4 py-2 font-sans text-sm font-semibold tracking-[0.12em] text-[var(--ink)] uppercase transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              Write a Question
            </button>
          </form>
        }
      />
    </footer>
  )
}

// "From Friends" shows at most this many of the most-recent milestone cards
// before collapsing the rest behind a "View more" control; each tap of "View
// more" then reveals another FROM_FRIENDS_STEP cards (and keeps the control
// while more remain).
const FROM_FRIENDS_COLLAPSED_COUNT = 5
const FROM_FRIENDS_STEP = 10

// The uppercase eyebrow that labels a feed section — the recency day labels
// ("Today", "This week") and the home-only pinned "For You" / "From Friends"
// sections all share this register. `first:pt-0` lets whichever heading renders
// first sit flush to the top of the feed.
function FeedSectionHeading({
  unifiedHome,
  subdued = false,
  prominent = false,
  windowLabel,
  subtitle,
  children,
}: {
  unifiedHome: boolean
  // D-HOME-DASHBOARD-MODEL-01 point 2 — under the single "Past 7 days" band
  // label the per-zone headings (From Friends / Recent activity) are demoted to
  // quiet sub-labels: a notch quieter and tighter to the band label above them,
  // reusing the same small-caps token family rather than a new visual system.
  subdued?: boolean
  // Same register as the page's top-level "For you" eyebrow (bold, ink-toned).
  // "From Friends" is promoted to this so it reads as a peer of "For you"
  // rather than a faint sub-label under a separate "Past 7 days" band row.
  prominent?: boolean
  // The 7-day boundary, folded onto the heading as a quiet "(Past 7 days)"
  // qualifier instead of stacking as its own eyebrow row above the section.
  windowLabel?: string
  // Optional one-line descriptor rendered tight beneath the eyebrow (the way
  // "For you" pairs with its descriptor). When present the heading + subtitle
  // are wrapped together so the wrapper — not the bare h2 — is the feed's
  // space-y child, and the subtitle's small margin isn't overridden by it.
  subtitle?: string
  children: ReactNode
}) {
  // On the unified-home feed the label sits flush left on the feed's left
  // gutter — the same 2px the activity rows pad in (where the shape column
  // begins) — rather than indenting past the icon column to the row copy.
  const gutter = unifiedHome ? 'pl-0.5' : ''
  // Top separation belongs on whichever node is the section's direct child: the
  // bare h2 normally, or the wrapper div when a subtitle pairs with it.
  const padClasses = subdued ? 'pt-1' : 'pt-4 first:pt-0'
  const typeClasses = prominent
    ? 'text-[13px] font-bold tracking-[0.1em] text-[var(--brand-ink-400)]'
    : subdued
      ? 'text-muted-foreground/50 text-[10px] font-medium tracking-[0.14em]'
      : 'text-muted-foreground/70 text-[11px] font-medium tracking-[0.12em]'

  const heading = (
    <h2 className={`uppercase ${typeClasses} ${subtitle ? '' : padClasses} ${gutter}`}>
      {children}
      {windowLabel ? (
        <span className="font-normal opacity-60"> ({windowLabel})</span>
      ) : null}
    </h2>
  )

  if (!subtitle) return heading

  return (
    <div className={padClasses}>
      {heading}
      {/* The descriptor shares the same small-caps register as the "For you"
          zone's descriptor ("questions your friends created or sent directly to
          you") so the two zones read as peers, rather than the serif italic it
          used to carry. */}
      <p
        className={`text-muted-foreground/70 mt-1 text-[11px] font-medium tracking-[0.12em] uppercase ${gutter}`}
      >
        {subtitle}
      </p>
    </div>
  )
}

function FeedListContent({
  pageSize = 20,
  infinite = false,
  initialPage = null,
  showContributeFooter = false,
  unifiedHome = false,
  activityItems = [],
  commonGroundPromo = null,
  expandingPromo = null,
  addFriendsPromo = null,
  budget = null,
  pendingQueue = false,
}: FeedListProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialFilterParam =
    searchParams.get('filter') ?? searchParams.get('feed_filter') ?? 'from-friends'
  // D-1 Stage 5: the feed is two surfaces — Broadcasts ('from-friends', default)
  // and Sent ('sent-to-me'). Legacy ?filter=all links land on Broadcasts.
  // unifiedHome overrides both: one merged surface pinned to 'all' so directly-
  // sent questions thread in alongside the activity stream. The pendingQueue
  // subpage windows the same 'all' source Home does, so it pins 'all' too.
  const initialFilter: FeedFilter =
    unifiedHome || pendingQueue
      ? 'all'
      : initialFilterParam === 'sent-to-me'
        ? 'sent-to-me'
        : 'from-friends'
  // initialPage is the server pre-fetch of the active surface, so it only seeds
  // state when that's the active filter; other surfaces fall back to a client
  // fetch. On unifiedHome/pendingQueue the prefetch is the 'all' page, so it
  // seeds directly.
  const initialPageMatchesFilter =
    initialPage !== null &&
    (unifiedHome || pendingQueue
      ? initialFilter === 'all'
      : initialFilter === 'from-friends')
  const [feedFilter, setFeedFilter] = useState<FeedFilter>(initialFilter)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const [items, setItems] = useState<FeedApiItem[]>(
    initialPageMatchesFilter ? initialPage!.items : []
  )
  const [nextCursor, setNextCursor] = useState<string | null>(
    initialPageMatchesFilter
      ? initialPage!.next_cursor ?? initialPage!.meta?.next_cursor ?? null
      : null
  )
  const [hasMore, setHasMore] = useState(
    initialPageMatchesFilter
      ? Boolean(initialPage!.has_more ?? initialPage!.meta?.has_more)
      : false
  )
  const [loadingInitial, setLoadingInitial] = useState(!initialPageMatchesFilter)
  const [loadingMore, setLoadingMore] = useState(false)
  const [feedMeta, setFeedMeta] = useState<FeedMeta | null>(
    initialPageMatchesFilter ? initialPage!.meta ?? null : null
  )
  const [results, setResults] = useState<Record<string, ResultState>>({})
  const [cardStates, setCardStates] = useState<Record<string, QuestionCardState>>({})
  // PRD §8.2.10 — after a thumbs-down or its undo, replace the card with a
  // transient inline confirmation line for ~4s. Tracks the per-item phase.
  const [thumbsdownConfirm, setThumbsdownConfirm] = useState<
    Record<string, 'removed' | 'restored'>
  >({})
  const thumbsdownTimersRef = useRef<Record<string, number>>({})
  // B-Feed-Swipe-1 — left-swipe / Dismiss collapse a card to an inline bar.
  // View-state only and session-scoped: 'collapsing' plays the exit animation,
  // 'dismissed' shows the bar. Never persisted; never mutes.
  const [dismissPhase, setDismissPhase] = useState<
    Record<string, 'collapsing' | 'dismissed'>
  >({})
  const dismissTimersRef = useRef<Record<string, number>>({})
  // The question's answer, fetched on-demand when a card is dismissed, to show
  // on the "back of the card". Keyed by feed-item id; cached across undo so a
  // re-dismiss reuses it without a refetch.
  const [dismissedAnswers, setDismissedAnswers] = useState<
    Record<string, { status: 'loading' | 'loaded' | 'error'; answer?: string | null }>
  >({})
  // Mirrors dismissPhase so async answer fetches can drop stale writes after an
  // undo / re-dismiss race.
  const dismissPhaseRef = useRef(dismissPhase)
  useEffect(() => {
    dismissPhaseRef.current = dismissPhase
  }, [dismissPhase])
  const reducedMotion = usePrefersReducedMotion()
  const [answerSheetId, setAnswerSheetId] = useState<string | null>(null)
  // In-sheet notice for the grade: warm "retrying…" while a transient grader
  // outage is auto-retried, then a terminal "try again later" once retries are
  // spent. Kept out of the page-level `error` so the feed's empty-state and
  // invite CTA are unaffected by a one-off grader hiccup.
  const [answerNotice, setAnswerNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(
    null,
  )
  const [feedbackSheetId, setFeedbackSheetId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hideToast, setHideToast] = useState<{ category: string } | null>(null)
  // "From Friends" starts capped to its most recent few milestone cards; each
  // "View more" reveals another batch. View-state only — never persisted.
  const [fromFriendsVisibleCount, setFromFriendsVisibleCount] = useState(
    FROM_FRIENDS_COLLAPSED_COUNT,
  )
  // True for the very first render path when we already have server-rendered
  // data; the initial-fetch useEffect skips its work once.
  const skipInitialFetchRef = useRef(initialPageMatchesFilter)

  const loadFeed = useCallback(
    async (cursor?: string | null) => {
      const isNextPage = Boolean(cursor)
      if (isNextPage) setLoadingMore(true)
      else setLoadingInitial(true)
      setError(null)

      try {
        const search = new URLSearchParams({
          limit: String(pageSize),
          filter: feedFilter,
        })
        if (cursor) search.set('cursor', cursor)

        const response = await fetch(`/api/feed?${search.toString()}`, {
          cache: 'no-store',
          credentials: 'include',
        })
        const body = (await response.json().catch(() => null)) as
          | FeedResponse
          | { message?: string; error?: string }
          | null
        if (!response.ok || !body || !('items' in body)) {
          const message =
            (body as { message?: string; error?: string } | null)?.message ??
            (body as { message?: string; error?: string } | null)?.error ??
            'Could not load your Feed.'
          throw new Error(message)
        }

        setFeedMeta(body.meta ?? null)
        setItems((current) =>
          isNextPage ? [...current, ...body.items] : body.items
        )
        setNextCursor(body.next_cursor ?? body.meta?.next_cursor ?? null)
        setHasMore(Boolean(body.has_more ?? body.meta?.has_more))
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : 'Could not load your Feed.'
        )
      } finally {
        setLoadingInitial(false)
        setLoadingMore(false)
      }
    },
    [feedFilter, pageSize]
  )

  // D-1 Stage 5: switching surface clears the previous tab's list (and its
  // stale infinite-scroll cursor) before the loadFeed effect refetches.
  const handleSelectTab = useCallback(
    (next: FeedFilter) => {
      if (next === feedFilter) return
      setItems([])
      setNextCursor(null)
      setHasMore(false)
      setLoadingInitial(true)
      setFeedFilter(next)
    },
    [feedFilter]
  )

  useEffect(() => {
    if (skipInitialFetchRef.current) {
      skipInitialFetchRef.current = false
      return
    }
    const timer = window.setTimeout(() => {
      void loadFeed()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadFeed])

  useEffect(() => {
    if (!infinite || !hasMore || loadingInitial || loadingMore || !nextCursor)
      return

    const sentinelNode = sentinelRef.current
    if (!sentinelNode) return

    if (!('IntersectionObserver' in window)) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadFeed(nextCursor)
        }
      },
      { rootMargin: '320px 0px' }
    )

    observer.observe(sentinelNode)
    return () => observer.disconnect()
  }, [hasMore, infinite, loadFeed, loadingInitial, loadingMore, nextCursor])

  // The unified-home render model: question cards + interleaved activity rows,
  // newest-first. groupItemsByRecency assumes descending order, so we sort here.
  // Activity is bounded (~30-day windows) and arrives once as a prop; the feed
  // paginates underneath, so re-sorting the whole union on every `items` change
  // settles activity into its correct chronological slots as older pages load.
  const unifiedRows = useMemo<UnifiedRow[]>(() => {
    const feedRows: UnifiedRow[] = items.map((item) => ({
      kind: 'feed',
      item,
      source_event_at: item.source_event_at,
      sortMs: Date.parse(item.source_event_at),
    }))
    if (!unifiedHome || activityItems.length === 0) return feedRows

    // Dedupe: a received_direct_question activity one-liner duplicates the
    // richer direct_sent feed card once that card has loaded — keep the card,
    // drop the one-liner. The link is the feed item id (carried on the row's
    // answer_direct action vs the feed item's own id).
    const feedIds = new Set(items.map((i) => i.id))
    const activityRows: UnifiedRow[] = []
    for (const item of activityItems) {
      if (item.action?.kind === 'answer_direct' && feedIds.has(item.action.feedItemId)) {
        continue
      }
      const sortAt = item.sortAt instanceof Date ? item.sortAt : new Date(item.sortAt)
      activityRows.push({
        kind: 'activity',
        item,
        source_event_at: sortAt.toISOString(),
        sortMs: sortAt.getTime(),
      })
    }
    // Under the budget (D-HOME-PACING-01) the zones are rendered as separate
    // sections, NOT one chronological stream, so the server's intra-zone order
    // is authoritative: rotate-by-sender for direct (§5), actor-interleave for
    // playables (§5), newest-first for the bounded texture. A global recency
    // re-sort here would undo that ordering, so preserve server order — feed
    // (direct) rows first, then activity (playables then texture) rows.
    if (budget) return [...feedRows, ...activityRows]
    return [...feedRows, ...activityRows].sort((a, b) => b.sortMs - a.sortMs)
  }, [items, activityItems, unifiedHome, budget])

  // Place the home-only discovery modules. They are NOT part of the chronological
  // union above; each renders whenever its data exists. Rather than clump them at
  // the top or tail, SPREAD the present modules evenly through the feed so they
  // read as occasional interludes, not a wall at the bottom. Each borrows a
  // neighbouring row's timestamp so recency grouping keeps it in that bucket.
  const displayRows = useMemo<UnifiedRow[]>(() => {
    const next = [...unifiedRows]

    const toRow = (item: StreamItem, anchor: UnifiedRow | null): UnifiedRow => {
      const sortAt = item.sortAt instanceof Date ? item.sortAt : new Date(item.sortAt)
      return {
        kind: 'activity',
        item,
        source_event_at: anchor ? anchor.source_event_at : sortAt.toISOString(),
        sortMs: anchor ? anchor.sortMs : sortAt.getTime(),
      }
    }

    const promos = [commonGroundPromo, expandingPromo, addFriendsPromo].filter(
      (p): p is StreamItem => p !== null && p !== undefined,
    )
    const baseLen = unifiedRows.length
    promos.forEach((promo, i) => {
      // Even fractions through the ORIGINAL feed (1/(k+1), 2/(k+1), …), never the
      // very first row; +i accounts for the promos already spliced in ahead.
      const target =
        baseLen === 0 ? 0 : Math.max(1, Math.round(((i + 1) * baseLen) / (promos.length + 1)))
      const spliceAt = Math.min(target + i, next.length)
      const anchor = spliceAt > 0 ? next[spliceAt - 1]! : null
      next.splice(spliceAt, 0, toRow(promo, anchor))
    })

    return next
  }, [unifiedRows, commonGroundPromo, expandingPromo, addFriendsPromo])

  // Home-only sectioning: the answerable question "big boxes" and friends'
  // milestone bundles are lifted out of the chronological stream into two
  // pinned sections at the top —
  //   • "For You"      — question cards a friend sent you directly or broadcast
  //                      (kind:'feed'); rendered as the full SparkleEnvelope
  //                      boxes you can answer; uncapped.
  //   • "From Friends" — friends' playable milestone bundles (the up-to-5-
  //                      triangle cards), capped to the most recent few.
  // Everything else — ambient activity, per-person roll-ups, promos — falls
  // through to `restRows` and keeps the existing recency grouping below. Off
  // the unified home (the standalone Feed tab) both sections are empty and
  // restRows is the whole list, so that surface renders exactly as before.
  const { forYouRows, fromFriendsRows, restRows } = useMemo(() => {
    if (!unifiedHome) {
      return {
        forYouRows: [] as UnifiedRow[],
        fromFriendsRows: [] as UnifiedRow[],
        restRows: displayRows,
      }
    }
    const forYou: UnifiedRow[] = []
    const fromFriends: UnifiedRow[] = []
    const rest: UnifiedRow[] = []
    for (const row of displayRows) {
      if (row.kind === 'feed') {
        forYou.push(row)
      } else if (
        row.kind === 'activity' &&
        row.item.expand?.kind === 'milestone' &&
        row.item.expand.questions.length > 0
      ) {
        fromFriends.push(row)
      } else {
        rest.push(row)
      }
    }
    return { forYouRows: forYou, fromFriendsRows: fromFriends, restRows: rest }
  }, [displayRows, unifiedHome])

  // "From Friends" reveals its most recent cards in batches (fromFriendsRows is
  // newest-first, so slicing the head keeps the latest). The "View more" control
  // appears while cards remain hidden; each tap reveals up to FROM_FRIENDS_STEP
  // more, and the label names how many that next tap will show.
  const visibleFromFriendsRows = fromFriendsRows.slice(0, fromFriendsVisibleCount)
  const fromFriendsHiddenCount =
    fromFriendsRows.length - visibleFromFriendsRows.length
  const fromFriendsNextBatch = Math.min(fromFriendsHiddenCount, FROM_FRIENDS_STEP)

  // D-HOME-DASHBOARD-MODEL-01 point 2 — the band-level "Past 7 days" label is
  // shown whenever the budget home renders the windowed ambient band. This is
  // the seam B-HOME-COLDSTART-06 hooks: for a cold-start user (friend count ≤ 1)
  // the window is relaxed and this flag flips false, so the label never asserts
  // a 7-day promise the page isn't keeping.
  const bandLabelVisible = Boolean(budget)

  // Empty Zone-2 sub-sections are now hidden outright (treatment chosen
  // 2026-06-15) rather than carrying an honest per-section empty state — this
  // reverses D-HOME-DASHBOARD-MODEL-01 point 4. Because of that, the band can
  // resolve to nothing on a page that still has Zone-1 "For you" content, so
  // the single "Past 7 days" boundary label is gated on the band actually
  // having something beneath it (a section's rows, or the quiet-week foot
  // panel) and never heads an empty band.
  const bandHasContent =
    fromFriendsRows.length > 0 || restRows.length > 0 || Boolean(budget?.panel)

  const emptyCopy = useMemo(() => {
    if (loadingInitial) return 'Loading your Feed...'
    if (error) return error
    // Sent surface: anyone can send you a question, so the follow-based
    // has_friends signal doesn't apply here.
    if (feedFilter === 'sent-to-me') {
      if ((feedMeta?.sent_item_count ?? 0) > 0)
        return "You've answered every question sent to you."
      return 'No one has sent you a question yet.'
    }
    if (!feedMeta?.has_friends)
      return 'When your friends play, their questions will show up here.'
    // pre_filter_active_count > 0 means items exist in active/skipped state but are hidden by domain filters
    if (
      feedMeta.has_dismissed_domains &&
      feedMeta.pre_filter_active_count > 0
    ) {
      return "You've focused your Feed. You can re-open domains from your Knowledge page."
    }
    if (feedMeta.total_item_count > 0)
      return "You've answered every question your friends sent."
    return 'Quiet today. Check back when your friends have played.'
  }, [error, feedFilter, feedMeta, loadingInitial])

  // The invite CTA makes sense on the friend-sourced Broadcasts surface and on
  // the unified-home feed (which includes the Broadcasts sources).
  const showInviteFriendCta =
    !loadingInitial &&
    !error &&
    Boolean(feedMeta) &&
    (feedFilter === 'from-friends' || (unifiedHome && feedFilter === 'all'))

  // Show the surface tabs whenever EITHER surface has content — not just the
  // active one. Otherwise a recipient sitting on an empty Broadcasts tab never
  // sees the "Sent (n)" tab/badge, so a question a friend sent them stays hidden.
  // The per-surface counts are live on every response (see surfaceActionableCount).
  const hasAnySurfaceContent =
    items.length > 0 ||
    (feedMeta?.broadcasts_item_count ?? 0) > 0 ||
    (feedMeta?.sent_item_count ?? 0) > 0

  const emptyDiagnostics = useMemo(() => {
    if (process.env.NODE_ENV === 'production' || !feedMeta) return null

    return [
      `has_friends=${String(feedMeta.has_friends)}`,
      `has_dismissed_domains=${String(feedMeta.has_dismissed_domains)}`,
      `total_item_count=${feedMeta.total_item_count}`,
      `pre_filter_active_count=${feedMeta.pre_filter_active_count}`,
      `broadcasts_item_count=${feedMeta.broadcasts_item_count}`,
      `sent_item_count=${feedMeta.sent_item_count}`,
      `active_item_count=${feedMeta.active_item_count}`,
      `page_item_count=${feedMeta.page_item_count ?? items.length}`,
      `limit=${feedMeta.limit ?? pageSize}`,
      `cursor=${feedMeta.cursor ?? 'none'}`,
      `next_cursor=${nextCursor ?? 'none'}`,
      `has_more=${String(hasMore)}`,
    ].join(' · ')
  }, [feedMeta, hasMore, items.length, nextCursor, pageSize])

  const removeItem = useCallback((itemId: string) => {
    setItems((current) => current.filter((item) => item.id !== itemId))
  }, [])

  const hideCategory = useCallback(async (item: FeedApiItem) => {
    if (!item.domain_pill) return
    const category = item.domain_pill
    setBusyId(item.id)
    setError(null)
    try {
      const response = await fetch('/api/feed/dismiss-domain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ domain: category }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.message ?? 'Could not hide that category.')
      }
      setItems((current) =>
        current.filter((currentItem) => currentItem.domain_pill !== category)
      )
      setHideToast({ category })
      window.setTimeout(() => {
        setHideToast((current) =>
          current?.category === category ? null : current
        )
      }, 4500)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not hide that category.'
      )
    } finally {
      setBusyId(null)
    }
  }, [])

  const hidePerson = useCallback(async (item: FeedApiItem) => {
    setBusyId(item.id)
    setError(null)
    try {
      const response = await fetch(`/api/feed/${item.id}/state`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ state: 'dismissed' }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(
          body?.message ?? 'Could not hide questions from that person.'
        )
      }
      setItems((current) =>
        current.filter(
          (currentItem) => currentItem.source_user_id !== item.source_user_id
        )
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not hide questions from that person.'
      )
    } finally {
      setBusyId(null)
    }
  }, [])

  const clearThumbsdownTimer = useCallback((itemId: string) => {
    const timer = thumbsdownTimersRef.current[itemId]
    if (timer) {
      window.clearTimeout(timer)
      delete thumbsdownTimersRef.current[itemId]
    }
  }, [])

  const dismissThumbsdownConfirm = useCallback(
    (itemId: string) => {
      clearThumbsdownTimer(itemId)
      const phase = thumbsdownConfirm[itemId]
      setThumbsdownConfirm((current) => {
        const next = { ...current }
        delete next[itemId]
        return next
      })
      if (phase === 'removed') {
        removeItem(itemId)
      }
    },
    [clearThumbsdownTimer, removeItem, thumbsdownConfirm]
  )

  useEffect(() => {
    return () => {
      Object.values(thumbsdownTimersRef.current).forEach((t) => window.clearTimeout(t))
      thumbsdownTimersRef.current = {}
      Object.values(dismissTimersRef.current).forEach((t) => window.clearTimeout(t))
      dismissTimersRef.current = {}
    }
  }, [])

  // Fetch the question's answer to show on the dismissed card back. Already-
  // answered cards carry it in the payload; answerless items short-circuit.
  // Skips refetching anything already loading/loaded (only errors retry).
  const loadDismissedAnswer = useCallback((item: FeedApiItem) => {
    if (item.correct_answer) {
      setDismissedAnswers((c) => ({
        ...c,
        [item.id]: { status: 'loaded', answer: item.correct_answer },
      }))
      return
    }
    if (!item.question_id) {
      setDismissedAnswers((c) => ({ ...c, [item.id]: { status: 'loaded', answer: null } }))
      return
    }
    let shouldFetch = true
    setDismissedAnswers((c) => {
      const existing = c[item.id]
      if (existing && existing.status !== 'error') {
        shouldFetch = false
        return c
      }
      return { ...c, [item.id]: { status: 'loading' } }
    })
    if (!shouldFetch) return

    void (async () => {
      try {
        const res = await fetch(`/api/feed/${item.id}/answer`, { method: 'GET' })
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as { answer: string | null }
        setDismissedAnswers((c) => {
          // Drop the write if the card is no longer dismissed (undo race).
          if (dismissPhaseRef.current[item.id] !== 'dismissed') return c
          return { ...c, [item.id]: { status: 'loaded', answer: data.answer } }
        })
      } catch {
        setDismissedAnswers((c) => ({ ...c, [item.id]: { status: 'error' } }))
      }
    })()
  }, [])

  // Persist a dismiss (or its undo) so the card stays gone — or comes back —
  // across reloads, not just in this session's view-state. The server filters
  // the feed to active/skipped, so a 'dismissed' row never returns; 'active'
  // restores it. Reuses the existing /state PATCH endpoint.
  const persistDismissState = useCallback(
    async (itemId: string, state: 'dismissed' | 'active') => {
      const response = await fetch(`/api/feed/${itemId}/state`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ state }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.message ?? 'Could not update that card.')
      }
      // §7: a dismiss (or its undo) on the overflow subpage also changes the
      // shared pending queue — invalidate the router cache like an answer does.
      if (pendingQueue) router.refresh()
    },
    [pendingQueue, router],
  )

  // Shared by the left-swipe and the on-card Dismiss button — one handler, one
  // animation. Plays the collapse, then swaps to the inline "Dismissed" bar.
  // The dismiss is optimistic: the card animates out immediately and the
  // 'dismissed' state is persisted in the background. If the persist fails the
  // card is restored and an error is surfaced, so a dismissed card can never
  // silently reappear (or silently fail to stick).
  const requestDismiss = useCallback(
    (item: FeedApiItem) => {
      const itemId = item.id
      void persistDismissState(itemId, 'dismissed').catch((caught) => {
        setDismissPhase((current) => {
          const next = { ...current }
          delete next[itemId]
          return next
        })
        setError(
          caught instanceof Error ? caught.message : 'Could not dismiss that card.',
        )
      })
      if (reducedMotion) {
        setDismissPhase((current) => ({ ...current, [itemId]: 'dismissed' }))
        loadDismissedAnswer(item)
        return
      }
      setDismissPhase((current) => ({ ...current, [itemId]: 'collapsing' }))
      dismissTimersRef.current[itemId] = window.setTimeout(() => {
        delete dismissTimersRef.current[itemId]
        setDismissPhase((current) => ({ ...current, [itemId]: 'dismissed' }))
        loadDismissedAnswer(item)
      }, 200)
    },
    [reducedMotion, loadDismissedAnswer, persistDismissState],
  )

  // Undo fully restores the card — no learning side effects, but it does
  // persist the card back to 'active' so the restore survives a reload.
  const undoDismiss = useCallback(
    (itemId: string) => {
      const timer = dismissTimersRef.current[itemId]
      if (timer) {
        window.clearTimeout(timer)
        delete dismissTimersRef.current[itemId]
      }
      setDismissPhase((current) => {
        const next = { ...current }
        delete next[itemId]
        return next
      })
      void persistDismissState(itemId, 'active').catch((caught) => {
        setError(
          caught instanceof Error ? caught.message : 'Could not restore that card.',
        )
      })
    },
    [persistDismissState],
  )

  const scheduleThumbsdownAutoDismiss = useCallback(
    (itemId: string) => {
      clearThumbsdownTimer(itemId)
      thumbsdownTimersRef.current[itemId] = window.setTimeout(() => {
        dismissThumbsdownConfirm(itemId)
      }, 4000)
    },
    [clearThumbsdownTimer, dismissThumbsdownConfirm]
  )

  const reportItem = useCallback(
    async (item: FeedApiItem) => {
      setBusyId(item.id)
      setError(null)
      try {
        const response = await fetch(`/api/feed/${item.id}/thumbsdown`, {
          method: 'POST',
          credentials: 'include',
        })
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          throw new Error(body?.message ?? 'Could not report that question.')
        }
        setThumbsdownConfirm((current) => ({ ...current, [item.id]: 'removed' }))
        scheduleThumbsdownAutoDismiss(item.id)
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Could not report that question.'
        )
      } finally {
        setBusyId(null)
      }
    },
    [scheduleThumbsdownAutoDismiss]
  )

  const undoThumbsdown = useCallback(
    async (itemId: string) => {
      setBusyId(itemId)
      setError(null)
      try {
        const response = await fetch(`/api/feed/${itemId}/thumbsdown`, {
          method: 'DELETE',
          credentials: 'include',
        })
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          throw new Error(body?.message ?? 'Could not undo that.')
        }
        clearThumbsdownTimer(itemId)
        setThumbsdownConfirm((current) => ({ ...current, [itemId]: 'restored' }))
        scheduleThumbsdownAutoDismiss(itemId)
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : 'Could not undo that.'
        )
      } finally {
        setBusyId(null)
      }
    },
    [clearThumbsdownTimer, scheduleThumbsdownAutoDismiss]
  )

  const submitAnswer = useCallback(
    async (item: FeedApiItem, submittedAnswer: string) => {
      setBusyId(item.id)
      setAnswerNotice(null)
      try {
        // A grader outage returns a retryable 503 (never a real 'wrong' verdict),
        // so auto-retry it with backoff behind a warm in-sheet notice, and only
        // ask the player to try again later once the retries are exhausted.
        const body = await submitAnswerWithRetry<AnswerResponse>(
          `/api/feed/${item.id}/answer`,
          {
            body: { submitted_answer: submittedAnswer },
            isSuccessBody: (value): value is AnswerResponse =>
              value != null && typeof value === 'object' && 'isCorrect' in value,
            onRetry: ({ attempt, maxAttempts }) =>
              setAnswerNotice({
                tone: 'info',
                text: `${ANSWER_GRADER_RETRY_MESSAGE} (${attempt}/${maxAttempts})…`,
              }),
          }
        )
        setAnswerNotice(null)
        const isCorrect = Boolean(body.isCorrect)
        setResults((current) => ({
          ...current,
          [item.id]: {
            correct: isCorrect,
            answer: body.correctAnswer ?? '',
            submittedAnswer,
            explanation: body.explanation ?? null,
            creatorNote: body.creatorNote ?? null,
            insideJoke: body.insideJoke ?? null,
            insideJokeKind: body.insideJokeKind ?? null,
            authorName: body.authorName ?? null,
            authorIsHouse: Boolean(body.authorIsHouse),
            awardedPoints: body.pointsAwarded ?? null,
            masteryDelta: body.masteryDelta ?? null,
            unverified: Boolean(body.unverified),
          },
        }))
        setItems((current) =>
          current.map((currentItem) =>
            currentItem.id === item.id
              ? {
                  ...currentItem,
                  state: 'answered',
                  card_type: 'answered_by_you',
                  type: 'answered_by_you',
                  submitted_answer: submittedAnswer,
                  answer_result: isCorrect ? 'correct' : 'incorrect',
                  is_correct: isCorrect,
                  correct_answer: body.correctAnswer ?? '',
                  awarded_points: body.pointsAwarded ?? null,
                  mastery_delta: body.masteryDelta ?? null,
                  explanation: body.explanation ?? currentItem.explanation,
                }
              : currentItem
          )
        )
        setCardStates((s) => ({ ...s, [item.id]: 'answered' }))
        setAnswerSheetId(null)
        setAnswerNotice(null)
        setFeedbackSheetId(item.id)
        // §7 hardening (B-HOME-OVERFLOW-02): an answer on the overflow subpage
        // shrinks the shared pending queue, so invalidate the client router
        // cache — a back-navigation to Home then refetches and recomputes its
        // top-N window instead of restoring a stale edition. Local list state
        // is untouched: the just-answered card stays visible as answered here.
        if (pendingQueue) router.refresh()
      } catch (caught) {
        // Keep the sheet open with the player's answer intact so they can resubmit.
        setAnswerNotice({
          tone: 'error',
          text:
            caught instanceof Error
              ? caught.message
              : 'Could not submit that answer.',
        })
      } finally {
        setBusyId(null)
      }
    },
    [pendingQueue, router]
  )

  const submitRecheck = useCallback(
    async (item: FeedApiItem): Promise<{ accepted: boolean; message: string }> => {
      const response = await fetch(`/api/feed/${item.id}/recheck`, {
        method: 'POST',
        credentials: 'include',
      })
      const body = (await response.json().catch(() => null)) as {
        accepted?: boolean
        status?: string
        reason?: string
        pointsAwarded?: number
        message?: string
      } | null
      if (!response.ok) {
        throw new Error(body?.message ?? 'Could not recheck that answer.')
      }
      const accepted = Boolean(body?.accepted)
      const pointsAwarded = typeof body?.pointsAwarded === 'number' ? body.pointsAwarded : 0
      if (accepted) {
        setItems((current) =>
          current.map((currentItem) =>
            currentItem.id === item.id
              ? { ...currentItem, is_correct: true, answer_result: 'correct', awarded_points: pointsAwarded }
              : currentItem
          )
        )
        setResults((current) => {
          const existing = current[item.id]
          if (!existing) return current
          return { ...current, [item.id]: { ...existing, correct: true, awardedPoints: pointsAwarded } }
        })
        return { accepted: true, message: `Recheck accepted — +${pointsAwarded} ${pointsAwarded === 1 ? 'point' : 'points'}.` }
      }
      if (body?.status === 'needs_human') {
        return { accepted: false, message: body.reason ?? 'Flagged for a human look.' }
      }
      return { accepted: false, message: body?.reason ?? 'Rechecked and still marked wrong.' }
    },
    []
  )

  // The home zones and the overflow subpages share one card treatment: elevated
  // Tier-1 cream cards with the relative timestamp hidden (the calmer register).
  // The standalone Broadcasts/Sent surfaces keep flat, timestamped cards.
  const homeZoneCards = unifiedHome || pendingQueue

  // One row of the rendered feed, shared by every section (the home-only "For
  // You" / "From Friends" splits and the recency groups all call this). Closes
  // over the card state + handlers, so each section just maps its rows through it.
  const renderRow = (row: GroupedRow<FeedApiItem>): ReactNode => {
    // A friend's relationship activity, gathered into one per-person
    // card (heading + their events). Grouped per bucket so it never
    // spans a day label.
    if (row.kind === 'person') {
      return (
        <PersonActivityCard
          key={`p-${row.friendId}-${row.rows[0]?.id ?? ''}`}
          friendId={row.friendId}
          rows={row.rows}
          timestampFor={(item) => formatRelativeTime(item.sortAt)}
        />
      )
    }
    // Interleaved activity (Lately) one-liner: self-contained,
    // renders its own row (no swipe/overflow/answer-sheet chrome).
    if (row.kind === 'activity') {
      // Home-only promos render as full-bleed editorial feature
      // sections (a calm "featured moment" wash) rather than ordinary
      // activity rows; everything else is a normal one-liner.
      const embed = row.item.embed
      if (embed?.kind === 'common_ground') {
        return <CommonGroundFeature key={`e-${row.item.id}`} embed={embed} />
      }
      if (embed?.kind === 'add_friends') {
        return <GrowYourCircleFeature key={`e-${row.item.id}`} embed={embed} />
      }
      if (embed?.kind === 'recently_expanding') {
        return <RecentlyExpandingFeature key={`e-${row.item.id}`} embed={embed} />
      }
      // From Friends milestone streaks render as a header + per-question
      // answer/dismiss cards (B-FROMFRIENDS-STREAK-HEADER-01) on the home zones
      // (Home + the /from-friends overflow, both `homeZoneCards`). The flat
      // /activities log keeps the collapsed one-liner bundle via
      // ActivityStreamItem below. Server budget is unchanged — whole streaks
      // only, never split.
      if (row.item.expand?.kind === 'milestone' && homeZoneCards) {
        return (
          <FromFriendsStreak
            key={`ff-${row.item.id}`}
            item={row.item}
            elevated={homeZoneCards}
          />
        )
      }
      // Everything else renders as a one-liner row, with its bundle triangle
      // mark + tap-to-answer expansion living inside ActivityStreamItem. On the
      // home feed the playable milestone bundles take the cream card treatment
      // (elevated) so they step forward from the flat ambient rows; the full
      // /activities log keeps every row flat.
      return (
        <ActivityStreamItem
          key={`a-${row.item.id}`}
          item={row.item}
          timestamp={formatRelativeTime(row.item.sortAt)}
          // The home "What's Happening" feed (and the overflow subpages, which
          // share its register) reads calmer without the per-row "1d ago"
          // ledger; the full /activities log keeps its timestamps.
          showTimestamp={!homeZoneCards}
          elevated={homeZoneCards}
        />
      )
    }
    const item = row.item
    const result = results[item.id]
    const cardState =
      cardStates[item.id] ??
      (item.state === 'answered' ? 'answered' : 'unanswered')
    const isAnswered = cardState === 'answered'
    const isBusy = busyId === item.id
    const confirmPhase = thumbsdownConfirm[item.id]

    if (confirmPhase) {
      return (
        <ThumbsdownConfirmRow
          key={item.id}
          phase={confirmPhase}
          onDismiss={() => dismissThumbsdownConfirm(item.id)}
          onUndo={() => void undoThumbsdown(item.id)}
          disabled={isBusy}
        />
      )
    }

    // Left-swipe / Dismiss collapses the card to this inline bar.
    // Undo restores it; "Not into {category}?" is the one mute path
    // here, reusing the existing category-mute handler.
    if (dismissPhase[item.id] === 'dismissed') {
      const dismissedAnswer = dismissedAnswers[item.id]
      return (
        <DismissedFeedBar
          key={item.id}
          category={visibleFeedCategory(item.domain_pill)}
          answer={
            dismissedAnswer?.status === 'loaded'
              ? dismissedAnswer.answer
              : undefined
          }
          answerLoading={!dismissedAnswer || dismissedAnswer.status === 'loading'}
          answerError={dismissedAnswer?.status === 'error'}
          onUndo={() => undoDismiss(item.id)}
          onMute={() => void hideCategory(item)}
          disabled={isBusy}
        />
      )
    }

    const overflow = (
      <FeedOverflowMenu
        sourceName={item.source_friend_display_name}
        category={item.domain_pill}
        question={
          item.question_id && item.question_text
            ? {
                id: item.question_id,
                text: item.question_text,
                domain: item.domain_pill,
              }
            : null
        }
        isInBank={item.is_in_bank}
        disabled={isBusy}
        onHideCategory={() => void hideCategory(item)}
        onHidePerson={() => void hidePerson(item)}
        onReport={() => void reportItem(item)}
      />
    )

    if (isAnswered) {
      const answeredItem = toAnsweredByYouItem(item, result, homeZoneCards)
      const isIncorrect = answeredItem.isCorrect === false
      const recheckAction: FeedRecheckAction | null = isIncorrect
        ? { onSubmit: () => submitRecheck(item) }
        : null
      // direct_sent wrong answers stay re-attemptable (server
      // allows the re-grade; clicking reopens the same answer
      // sheet). Other source types still close on answer.
      const onRetry =
        isIncorrect && item.source_type === 'direct_sent'
          ? () => {
              setAnswerNotice(null)
              setAnswerSheetId(item.id)
            }
          : undefined
      return (
        <AnsweredByYouCard
          key={item.id}
          item={answeredItem}
          recheckAction={recheckAction}
          onRetry={onRetry}
          overflow={overflow}
        />
      )
    }

    const typedItem = toTypedFeedItem(item, homeZoneCards)
    const dismissible = !item.viewer_is_author
    const onAnswer = dismissible
      ? () => {
          setAnswerNotice(null)
          setAnswerSheetId(item.id)
        }
      : undefined
    const onDismiss = dismissible ? () => requestDismiss(item) : undefined

    // B-VIA-ATTRIBUTION-01: the "Via [friend]" answerer line, rendered above the
    // Answer action. Only on questions with a non-empty follow-gated answerer
    // set; the answered-by-you card keeps its existing paired-friend treatment.
    const viaAttribution =
      item.via_answerers && item.via_answerers.length > 0 ? (
        <ViaAttribution answerers={item.via_answerers} />
      ) : undefined

    // D-4 via-attribution: the gated "by {author}" / "via {source}" discovery
    // affordance. Server emits only the signals that cleared the stranger +
    // opt-in + public gates; render whatever survived.
    const discoveryAttribution =
      item.discovery_author || item.discovery_via ? (
        <DiscoveryAttribution author={item.discovery_author} via={item.discovery_via} />
      ) : undefined

    // On the home "What's Happening" feed these answerable question cards are
    // the playable rows, interleaved with flat activity one-liners — give them
    // the Tier 1 lift (cream fill + stroke + drop shadow) so they step forward.
    let card: ReactNode
    if (typedItem.type === 'direct_sent') {
      card = (
        <DirectSentCard
          item={typedItem}
          overflow={overflow}
          onAnswer={onAnswer}
          onDismiss={onDismiss}
          viaAttribution={viaAttribution}
          discoveryAttribution={discoveryAttribution}
          elevated={homeZoneCards}
        />
      )
    } else if (typedItem.type === 'friend_liked') {
      card = (
        <FriendLikedCard
          item={typedItem}
          overflow={overflow}
          onAnswer={onAnswer}
          onDismiss={onDismiss}
          viaAttribution={viaAttribution}
          discoveryAttribution={discoveryAttribution}
          elevated={homeZoneCards}
        />
      )
    } else {
      card = (
        <FriendAddedCard
          item={typedItem}
          overflow={overflow}
          onAnswer={onAnswer}
          onDismiss={onDismiss}
          viaAttribution={viaAttribution}
          discoveryAttribution={discoveryAttribution}
          elevated={homeZoneCards}
        />
      )
    }

    if (!dismissible) {
      return <Fragment key={item.id}>{card}</Fragment>
    }

    // Right-swipe answers, left-swipe dismisses (same handler as the
    // Dismiss button). The collapse on commit animates here.
    const collapsing = dismissPhase[item.id] === 'collapsing'
    return (
      <div
        key={item.id}
        className={collapsing ? 'feed-card-collapsing' : undefined}
      >
        <FeedCardSwipe
          onSwipeLeft={() => requestDismiss(item)}
          onSwipeRight={onAnswer}
          disabled={isBusy || collapsing}
        >
          {card}
        </FeedCardSwipe>
      </div>
    )
  }

  return (
    <>
      {/* Surface switcher shows whenever either surface has content, so the
          "Sent (n)" tab stays reachable even when the active Broadcasts tab is
          empty (otherwise a directly-sent question would be hidden behind a tab
          the recipient can't see). Fully empty feeds still fall back to the
          empty state's own "Questions from friends" eyebrow. */}
      {!unifiedHome && !pendingQueue && hasAnySurfaceContent ? (
        <FeedSurfaceTabs active={feedFilter} meta={feedMeta} onSelect={handleSelectTab} />
      ) : null}

      {hideToast ? (
        <div
          role="status"
          aria-live="polite"
          className="text-muted-foreground mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2 text-sm italic"
        >
          <span>Hidden questions about {hideToast.category}.</span>
          <Link
            href="/knowledge#focused-feed"
            className="text-foreground text-xs font-medium not-italic underline-offset-4 hover:underline"
          >
            Manage on your knowledge page →
          </Link>
        </div>
      ) : null}

      {unifiedRows.length === 0 ? (
        loadingInitial ? (
          <section className="flex min-h-48 flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground text-sm">{emptyCopy}</p>
          </section>
        ) : error ? (
          <section className="flex min-h-48 flex-col items-center justify-center gap-3 py-12 text-center">
            <p className="text-destructive text-sm">{emptyCopy}</p>
            {emptyDiagnostics ? (
              <p className="bg-muted text-muted-foreground max-w-xl rounded px-3 py-2 font-mono text-xs break-words">
                {emptyDiagnostics}
              </p>
            ) : null}
          </section>
        ) : unifiedHome || pendingQueue ? (
          // D-HOME-PACING-01 §9 — the all-three-empty home edition. The hero
          // and composer always render around this; this is the inline empty
          // state between them (NOT a full-screen takeover), reviving the
          // earlier centered treatment: the speech-bubble graphic over a serif
          // headline carrying the existing §8.2.8/§8.2.12 copy. The rotating
          // panel does NOT also render here — the empty state is the one
          // invitation (no double-invite).
          <section className="flex flex-col items-center gap-3 py-8 text-center">
            <SpeechBubbleIllustration className="h-24 w-auto" />
            <h2 className="font-serif text-xl font-medium text-[var(--brand-ink)]">
              {emptyCopy}
            </h2>
            {showInviteFriendCta ? (
              <Link
                href="/friends"
                className="font-serif text-lg font-semibold tracking-[0.05em] text-[var(--brand-orange)] underline underline-offset-4"
              >
                add friends →
              </Link>
            ) : null}
            {emptyDiagnostics ? (
              <p className="bg-muted text-muted-foreground mt-3 max-w-xl rounded px-3 py-2 font-mono text-xs break-words">
                {emptyDiagnostics}
              </p>
            ) : null}
          </section>
        ) : (
          // Questions-from-Friends empty state (standalone Feed surface) — a
          // muted eyebrow (standing in for the hidden surface tabs), a left-
          // aligned serif headline, the centered speech-bubble art, and a
          // right-aligned orange "add friends" link.
          <section className="py-4">
            <p className="text-[13px] font-bold tracking-[0.1em] text-[var(--brand-ink-400)] uppercase">
              Questions from friends
            </p>
            <h2 className="mt-1 font-serif text-lg font-medium text-[var(--brand-ink)]">
              You are all caught up!
            </h2>
            <div className="my-3 flex justify-center">
              <SpeechBubbleIllustration className="h-24 w-auto" />
            </div>
            {showInviteFriendCta ? (
              <div className="flex justify-end">
                <Link
                  href="/friends"
                  className="font-serif text-lg font-semibold tracking-[0.05em] text-[var(--brand-orange)] underline underline-offset-4"
                >
                  add friends →
                </Link>
              </div>
            ) : null}
            {emptyDiagnostics ? (
              <p className="bg-muted text-muted-foreground mt-3 max-w-xl rounded px-3 py-2 font-mono text-xs break-words">
                {emptyDiagnostics}
              </p>
            ) : null}
          </section>
        )
      ) : (
        <section className="space-y-3 pb-8">
          {/* Home-only: the answerable question cards a friend sent/broadcast to
              you (the full-size SparkleEnvelope "big boxes") are pinned into a
              "For You" section at the very top — above "From Friends".
              groupActivityByFriend is a pass-through here (feed rows never
              group), keeping the render path uniform. */}
          {forYouRows.length > 0 ? (
            <Fragment key="for-you">
              <FeedSectionHeading unifiedHome={unifiedHome}>
                questions your friends created or sent directly to you
              </FeedSectionHeading>
              {groupActivityByFriend(forYouRows).map(renderRow)}
              {/* D-HOME-PACING-01 §3 — quiet overflow row. Abundance, never
                  obligation; the subpage it will open is B-HOME-OVERFLOW-02. */}
              {budget && budget.directOverflowCount > 0 ? (
                <OverflowRow
                  unifiedHome={unifiedHome}
                  label={`${budget.directOverflowCount} more from friends →`}
                  href="/for-you"
                />
              ) : null}
            </Fragment>
          ) : null}
          {/* Zone 2 — the ambient band, bounded to the rolling 7-day window
              (D-HOME-DASHBOARD-MODEL-01). The 7-day boundary is no longer its
              own eyebrow row (that read as a third stacked eyebrow above "From
              Friends"); it is folded onto the lead section heading as a quiet
              "(Past 7 days)" qualifier — From Friends when present, else Recent
              activity. Both From Friends and Recent activity sit in the
              prominent "For you" register so the home zones read as peers.
              The pendingQueue subpages and the off-budget standalone Feed keep
              their own (un-banded) treatments. */}
          {budget ? (
            <Fragment key="past-7-days">
              {/* From Friends — friends' playable milestone bundles. The server
                  capped the served slice (Playables 4); render it and surface the
                  remainder as a quiet "N more →". Hidden outright when nothing
                  landed in-window (no per-section empty state, 2026-06-15).
                  groupActivityByFriend is a pass-through (milestone rows never
                  group). */}
              {fromFriendsRows.length > 0 ? (
                <Fragment key="from-friends">
                  <FeedSectionHeading
                    unifiedHome={unifiedHome}
                    prominent
                    windowLabel={bandLabelVisible && bandHasContent ? 'Past 7 days' : undefined}
                    subtitle="Answer or pass — each question stands on its own."
                  >
                    From Friends
                  </FeedSectionHeading>
                  {groupActivityByFriend(fromFriendsRows).map(renderRow)}
                  {budget.playablesOverflowCount > 0 ? (
                    // D-B: overflow counts BUNDLES (whole streaks), not
                    // questions — playablesOverflowCount is the bundle remainder.
                    <OverflowRow
                      unifiedHome={unifiedHome}
                      label={`${budget.playablesOverflowCount} more from friends →`}
                      href="/from-friends"
                    />
                  ) : null}
                </Fragment>
              ) : null}
              {/* Recent activity — the ambient texture stream (relationship
                  events, convergence, social moments) as full-sentence LONE
                  events (D-FEED-GROUP3-01 §2). The one rotating panel splices
                  after the lead rows (§2 slot 5); the "See more activity →" row
                  closes the zone. Hidden outright when nothing in-window
                  (no per-section empty state, 2026-06-15). */}
              {restRows.length > 0 ? (
                <Fragment key="texture">
                  <FeedSectionHeading
                    unifiedHome={unifiedHome}
                    prominent
                    windowLabel={
                      bandLabelVisible && bandHasContent && fromFriendsRows.length === 0
                        ? 'Past 7 days'
                        : undefined
                    }
                  >
                    Recent activity
                  </FeedSectionHeading>
                  {restRows.slice(0, TEXTURE_LEAD_COUNT).map(renderRow)}
                  {budget.panel ? renderRow(panelRow(budget.panel)) : null}
                  {restRows.slice(TEXTURE_LEAD_COUNT).map(renderRow)}
                  <OverflowRow
                    unifiedHome={unifiedHome}
                    label="See more activity →"
                    href="/activities"
                  />
                </Fragment>
              ) : null}
              {/* Quiet-week foot fallback — when the texture zone is empty the
                  single rotating panel still renders once, here, instead of
                  mid-zone (suppressed on the all-empty page, where the server
                  sends panel: null). */}
              {budget.panel && restRows.length === 0 ? renderRow(panelRow(budget.panel)) : null}
            </Fragment>
          ) : pendingQueue ? (
            // Overflow subpage — the full pending queue flat, in the server's
            // zone order, with no headings / panel / band (the page header
            // carries the one title).
            restRows.length > 0 ? (
              <Fragment key="texture">{restRows.map(renderRow)}</Fragment>
            ) : null
          ) : (
            // Off-budget standalone Feed — From Friends with the client "View
            // more" batching, then the legacy recency-grouped stream. This
            // surface is unwindowed, so it carries no "Past 7 days" band.
            <Fragment key="off-budget">
              {fromFriendsRows.length > 0 ? (
                <Fragment key="from-friends">
                  <FeedSectionHeading unifiedHome={unifiedHome}>From Friends</FeedSectionHeading>
                  {groupActivityByFriend(visibleFromFriendsRows).map(renderRow)}
                  {fromFriendsHiddenCount > 0 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setFromFriendsVisibleCount((count) => count + FROM_FRIENDS_STEP)
                      }
                      className={`flex min-h-11 items-center text-[13px] font-medium tracking-[0.04em] text-[var(--brand-link)] underline underline-offset-4 transition hover:opacity-70 ${
                        unifiedHome ? 'pl-0.5' : ''
                      }`}
                    >
                      View {fromFriendsNextBatch} more
                    </button>
                  ) : null}
                </Fragment>
              ) : null}
              {groupItemsByRecency(restRows).map((group) => (
                <Fragment key={group.key}>
                  <FeedSectionHeading unifiedHome={unifiedHome}>{group.label}</FeedSectionHeading>
                  {group.items.map(renderRow)}
                </Fragment>
              ))}
            </Fragment>
          )}
        </section>
      )}

      {infinite && hasMore ? (
        <div ref={sentinelRef} className="py-4 text-center" aria-live="polite">
          {loadingMore ? (
            <p className="text-muted-foreground text-sm">
              Loading more Feed...
            </p>
          ) : null}
        </div>
      ) : null}

      {/* The always-on "Find friends" interlude sits directly above the Write
          composer at the feed tail (D-HOME-PACING-01 update: promoted out of the
          single mid-feed panel slot so it surfaces every load). */}
      {budget?.growCircle && !loadingInitial ? renderRow(panelRow(budget.growCircle)) : null}

      {showContributeFooter && !loadingInitial ? <FeedContributeFooter /> : null}

      {answerSheetId ? (() => {
        const sheetItem = items.find((item) => item.id === answerSheetId)
        if (!sheetItem) return null
        return (
          <AnswerSheet
            question={sheetItem.question_text ?? ''}
            category={sheetItem.domain_pill}
            onSubmit={(answer) => void submitAnswer(sheetItem, answer)}
            onClose={() => {
              setAnswerSheetId(null)
              setAnswerNotice(null)
            }}
            loading={busyId === sheetItem.id}
            statusMessage={answerNotice?.tone === 'info' ? answerNotice.text : null}
            errorMessage={answerNotice?.tone === 'error' ? answerNotice.text : null}
          />
        )
      })() : null}

      {feedbackSheetId ? (() => {
        const sheetItem = items.find((item) => item.id === feedbackSheetId)
        const result = results[feedbackSheetId]
        if (!sheetItem || !result || !sheetItem.question_id) return null
        return (
          <AnswerFeedbackSheet
            question={sheetItem.question_text ?? ''}
            category={sheetItem.domain_pill}
            isCorrect={result.correct}
            pointsAwarded={result.awardedPoints}
            correctAnswer={result.answer}
            submittedAnswer={result.submittedAnswer}
            explanation={result.explanation}
            creatorNote={result.creatorNote}
            insideJoke={result.insideJoke}
            insideJokeKind={result.insideJokeKind}
            authorName={result.authorName}
            authorIsHouse={result.authorIsHouse}
            openedNewTerritory={pickOpenedNewTerritory(result.masteryDelta)}
            openedTerritoryDomain={pickOpenedTerritoryDomain(result.masteryDelta)}
            questionId={sheetItem.question_id}
            feedItemId={sheetItem.id}
            unverified={result.unverified}
            onRecheck={result.correct ? null : () => submitRecheck(sheetItem)}
            onClose={() => setFeedbackSheetId(null)}
          />
        )
      })() : null}
    </>
  )
}

