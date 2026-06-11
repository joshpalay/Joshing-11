'use client'

import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AnsweredByYouCard,
  AnswerFeedbackSheet,
  AnswerSheet,
  DirectSentCard,
  DismissedFeedBar,
  FeedCardSwipe,
  FeedOverflowMenu,
  FriendAddedCard,
  FriendLikedCard,
  visibleFeedCategory,
  type AnsweredByYouFeedItem,
  type DirectSentFeedItem,
  type FeedRecheckAction,
  type FriendAddedFeedItem,
  type FriendLikedFeedItem,
} from '@/components/feed'
import { usePrefersReducedMotion } from '@/components/feed/usePrefersReducedMotion'
import { SpeechBubbleIllustration } from '@/components/home/FeedEmptyArt'
import { formatRelativeTime, groupItemsByRecency } from '@/components/feed/visual'
import { pickOpenedNewTerritory, pickOpenedTerritoryDomain } from '@/components/feed/territory'
import { ActivityStreamItem } from '@/components/activity/ActivityStreamItem'
import { PersonActivityCard } from '@/components/activity/PersonActivityCard'
import { groupActivityByFriend, type GroupInputRow, type GroupedRow } from '@/components/feed/person-grouping'
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
  pointsAwarded?: number | null
  masteryDelta?: unknown | null
}

type ResultState = {
  correct: boolean
  answer: string
  submittedAnswer: string
  explanation: string | null
  creatorNote: string | null
  insideJoke: string | null
  insideJokeKind: InsideJokeKind | null
  awardedPoints: number | null
  masteryDelta: unknown | null
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
   * Home-only "Shared Ground" common-ground promo (the overlapping-circle
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
}

type QuestionCardState = 'unanswered' | 'answered'

// One row of the unified-home feed: either a paginated question card or an
// interleaved activity (Lately) one-liner. Both carry `source_event_at` so the
// existing recency grouping works over the merged list unchanged. The per-person
// grouping helpers live in ./feed/person-grouping (pure + unit-tested).
type UnifiedRow = GroupInputRow<FeedApiItem>

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
// opens the writer. Pure so the two branches stay test-covered without a DOM.
export function buildQuestionWriterHref(idea: string): string {
  const trimmed = idea.trim()
  return trimmed
    ? `/questions?create=1&intent=bank&text=${encodeURIComponent(trimmed)}`
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
    <footer className="pt-6 pb-8">
      {/* Add-a-Question prompt — the same full-bleed editorial wash language as
          the feed's other featured moments (no card, border, or triangle
          mosaic): a parchment band that bleeds to the feed edges, with an
          eyebrow, the serif prompt, and the composer. The box stays an input:
          the reader's typed idea rides to the writer via ?text=
          (buildQuestionWriterHref). */}
      <div className="-mx-4 mt-6 bg-[var(--editorial-parchment)] px-[30px] py-12 md:py-14">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-[var(--brand-orange)] uppercase">
          Your Turn
        </p>
        <h2 className="mt-4 max-w-[20ch] font-serif text-[26px] leading-[1.15] font-medium text-[var(--brand-ink)] md:text-[32px]">
          Sometimes the best way to show you know someone is to ask them a
          question.
        </h2>
        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
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
              className="min-h-[180px] w-full resize-none rounded-[8px] border border-[var(--brand-border)] bg-[var(--brand-card)] px-4 py-3 text-base text-[var(--brand-ink)] outline-none focus:border-[var(--brand-link)]"
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
          <button
            type="submit"
            className="text-primary-foreground flex min-h-11 w-full items-center justify-center rounded-[4px] bg-[var(--brand-link)] text-base font-bold tracking-[0.04em] transition hover:opacity-90"
          >
            Write a Question
          </button>
        </form>
      </div>
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
  children,
}: {
  unifiedHome: boolean
  children: ReactNode
}) {
  return (
    <h2
      className={`text-muted-foreground/70 pt-4 text-[11px] font-medium tracking-[0.12em] uppercase first:pt-0 ${
        // On the unified-home feed, the label sits flush left on the feed's left
        // gutter — the same 2px the activity rows pad in (where the shape column
        // begins) — rather than indenting past the icon column to the row copy.
        unifiedHome ? 'pl-[2px]' : ''
      }`}
    >
      {children}
    </h2>
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
}: FeedListProps) {
  const searchParams = useSearchParams()
  const initialFilterParam =
    searchParams.get('filter') ?? searchParams.get('feed_filter') ?? 'from-friends'
  // D-1 Stage 5: the feed is two surfaces — Broadcasts ('from-friends', default)
  // and Sent ('sent-to-me'). Legacy ?filter=all links land on Broadcasts.
  // unifiedHome overrides both: one merged surface pinned to 'all' so directly-
  // sent questions thread in alongside the activity stream.
  const initialFilter: FeedFilter = unifiedHome
    ? 'all'
    : initialFilterParam === 'sent-to-me'
      ? 'sent-to-me'
      : 'from-friends'
  // initialPage is the server pre-fetch of the active surface, so it only seeds
  // state when that's the active filter; other surfaces fall back to a client
  // fetch. On unifiedHome the prefetch is the 'all' page, so it seeds directly.
  const initialPageMatchesFilter =
    initialPage !== null &&
    (unifiedHome ? initialFilter === 'all' : initialFilter === 'from-friends')
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
    return [...feedRows, ...activityRows].sort((a, b) => b.sortMs - a.sortMs)
  }, [items, activityItems, unifiedHome])

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
    },
    [],
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
            awardedPoints: body.pointsAwarded ?? null,
            masteryDelta: body.masteryDelta ?? null,
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
    []
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
          // The home "What's Happening" feed reads calmer without the per-row
          // "1d ago" ledger; the full /activities log keeps its timestamps.
          showTimestamp={!unifiedHome}
          elevated={unifiedHome}
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
      const answeredItem = toAnsweredByYouItem(item, result, unifiedHome)
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

    const typedItem = toTypedFeedItem(item, unifiedHome)
    const dismissible = !item.viewer_is_author
    const onAnswer = dismissible
      ? () => {
          setAnswerNotice(null)
          setAnswerSheetId(item.id)
        }
      : undefined
    const onDismiss = dismissible ? () => requestDismiss(item) : undefined

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
          elevated={unifiedHome}
        />
      )
    } else if (typedItem.type === 'friend_liked') {
      card = (
        <FriendLikedCard
          item={typedItem}
          overflow={overflow}
          onAnswer={onAnswer}
          onDismiss={onDismiss}
          elevated={unifiedHome}
        />
      )
    } else {
      card = (
        <FriendAddedCard
          item={typedItem}
          overflow={overflow}
          onAnswer={onAnswer}
          onDismiss={onDismiss}
          onHideCategory={() => void hideCategory(item)}
          elevated={unifiedHome}
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
      {!unifiedHome && hasAnySurfaceContent ? (
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
        ) : (
          // Questions-from-Friends empty state — matches the Figma mock: a muted
          // eyebrow (standing in for the hidden surface tabs), a left-aligned
          // serif headline, the centered speech-bubble art, and a right-aligned
          // orange "add friends" link.
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
              <FeedSectionHeading unifiedHome={unifiedHome}>For You</FeedSectionHeading>
              {groupActivityByFriend(forYouRows).map(renderRow)}
            </Fragment>
          ) : null}
          {/* Home-only: friends' milestone bundles (the up-to-5-triangle cards
              you can answer inline) are pinned into a "From Friends" section
              below "For You", capped to the most recent few with a "View more"
              control. groupActivityByFriend is a pass-through here (milestone
              rows never group), keeping the render path uniform. */}
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
                    unifiedHome ? 'pl-[2px]' : ''
                  }`}
                >
                  View {fromFriendsNextBatch} more
                </button>
              ) : null}
            </Fragment>
          ) : null}
          {/* Everything else — question cards sent to you, relationship events,
              promos — stays in a single calm chronological stream grouped by
              recency, rendered as full-sentence LONE events (D-FEED-GROUP3-01 §2
              styling). Per-person clustering (PersonActivityCard) stays dropped
              here: the cluster form was the source of the subject-stripped
              "wording is weird" copy, and density now comes from visual quiet. */}
          {groupItemsByRecency(restRows).map((group) => (
            <Fragment key={group.key}>
              <FeedSectionHeading unifiedHome={unifiedHome}>{group.label}</FeedSectionHeading>
              {group.items.map(renderRow)}
            </Fragment>
          ))}
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
            openedNewTerritory={pickOpenedNewTerritory(result.masteryDelta)}
            openedTerritoryDomain={pickOpenedTerritoryDomain(result.masteryDelta)}
            questionId={sheetItem.question_id}
            feedItemId={sheetItem.id}
            onRecheck={result.correct ? null : () => submitRecheck(sheetItem)}
            onClose={() => setFeedbackSheetId(null)}
          />
        )
      })() : null}
    </>
  )
}

