'use client'

import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  AnsweredByYouCard,
  AnswerFeedbackSheet,
  AnswerSheet,
  DirectSentCard,
  DismissedFeedBar,
  FeedCardSwipe,
  FeedOverflowMenu,
  FriendAddedCard,
  FriendAnsweredCard,
  FriendLikedCard,
  visibleFeedCategory,
  type AnsweredByYouFeedItem,
  type DirectSentFeedItem,
  type FeedRecheckAction,
  type FriendAddedFeedItem,
  type FriendAnsweredFeedItem,
  type FriendLikedFeedItem,
} from '@/components/feed'
import { usePrefersReducedMotion } from '@/components/feed/usePrefersReducedMotion'
import { formatRelativeTime, groupItemsByRecency } from '@/components/feed/visual'
import { pickOpenedNewTerritory, pickOpenedTerritoryDomain } from '@/components/feed/territory'

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
    | 'friend_answered'
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
  quip?: string | null
  insideJoke?: string | null
  pointsAwarded?: number | null
  masteryDelta?: unknown | null
}

type ResultState = {
  correct: boolean
  answer: string
  submittedAnswer: string
  explanation: string | null
  quip: string | null
  insideJoke: string | null
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

function feedMetadata(item: FeedApiItem, answered = false) {
  const time = formatEventTime(item.source_event_at)
  const source = (
    <span>
      <FeedPersonLink
        href={item.source_profile_href ?? profileHref(item.source_user_id)}
        name={item.source_friend_display_name}
      />{' '}
      {item.source_type === 'direct_sent'
        ? 'sent this to you'
        : item.source_type === 'authored_shared'
          ? 'wrote this'
          : item.source_type === 'thumbs_upped'
            ? 'liked this'
            : 'answered this'}
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

function baseTypedFields(item: FeedApiItem, answered = false) {
  return {
    id: item.id,
    metadata: feedMetadata(item, answered),
    category: item.domain_pill,
    question: item.question_text ?? 'Untitled question',
    personalMessage: item.personal_message,
    isInBank: item.is_in_bank,
    avatarName: item.source_friend_display_name,
    avatarUserId: item.source_user_id,
    authorHref: item.source_profile_href ?? profileHref(item.source_user_id),
    timestamp: formatRelativeTime(item.source_event_at),
    viewerIsAuthor: item.viewer_is_author === true,
  }
}

function friendAnsweredSummary(item: FeedApiItem) {
  const primaryFriend = item.friend_results?.[0]
  const friendName =
    primaryFriend?.displayName ?? item.source_friend_display_name

  if (primaryFriend?.result === 'correct' || item.source_result === 'correct') {
    return `${friendName} recognized this one. See if you share the same common ground.`
  }

  return `${friendName} answered this question.`
}

function toTypedFeedItem(item: FeedApiItem) {
  const base = baseTypedFields(item)

  if (item.card_type === 'direct_sent') {
    return {
      ...base,
      type: 'direct_sent' as const,
      senderName: item.source_friend_display_name,
      senderHref: item.source_profile_href ?? profileHref(item.source_user_id),
    } satisfies DirectSentFeedItem
  }

  if (item.card_type === 'friend_added') {
    return {
      ...base,
      type: 'friend_added' as const,
      friendName: item.source_friend_display_name,
      friendHref: item.source_profile_href ?? profileHref(item.source_user_id),
    } satisfies FriendAddedFeedItem
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

  const correctFriends = (item.friend_results ?? [])
    .filter((friend) => friend.result === 'correct')
    .map((friend) => ({
      userId: friend.userId,
      displayName: friend.displayName,
      href: profileHref(friend.userId),
    }))

  // If we have no aggregated friend_results but the source friend got it right, synthesize one.
  if (
    correctFriends.length === 0 &&
    item.source_result === 'correct' &&
    item.source_user_id
  ) {
    correctFriends.push({
      userId: item.source_user_id,
      displayName: item.source_friend_display_name,
      href: profileHref(item.source_user_id),
    })
  }

  return {
    ...base,
    type: 'friend_answered' as const,
    friendName:
      item.friend_results?.[0]?.displayName ?? item.source_friend_display_name,
    friendHref: profileHref(
      item.friend_results?.[0]?.userId ?? item.source_user_id
    ),
    friendCorrect:
      item.friend_results?.[0]?.result === 'correct' ||
      item.source_result === 'correct',
    answerSummary: friendAnsweredSummary(item),
    correctFriends,
    viewerResult: item.viewer_answer_status?.result ?? null,
  } satisfies FriendAnsweredFeedItem
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
  result?: ResultState
): AnsweredByYouFeedItem {
  const masteryDeltaRaw = result?.masteryDelta ?? item.mastery_delta
  return {
    ...baseTypedFields(item, true),
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
    quip: result?.quip ?? null,
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
}

type QuestionCardState = 'unanswered' | 'answered'

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

function FeedListContent({
  pageSize = 20,
  infinite = false,
  initialPage = null,
}: FeedListProps) {
  const searchParams = useSearchParams()
  const initialFilterParam =
    searchParams.get('filter') ?? searchParams.get('feed_filter') ?? 'all'
  const initialFilter: FeedFilter =
    initialFilterParam === 'sent-to-me' || initialFilterParam === 'from-friends'
      ? initialFilterParam
      : 'all'
  // initialPage is only valid for the 'all' filter (that's what the server
  // pre-fetches). If the URL pins a different filter, fall back to client fetch.
  const initialPageMatchesFilter = initialPage !== null && initialFilter === 'all'
  const [feedFilter] = useState<FeedFilter>(initialFilter)
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
  const [feedbackSheetId, setFeedbackSheetId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hideToast, setHideToast] = useState<{ category: string } | null>(null)
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

  const emptyCopy = useMemo(() => {
    if (loadingInitial) return 'Loading your Feed...'
    if (error) return error
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
      return "You've answered every question your friends sent. Invite more friends and their questions will show up here."
    return 'Quiet today. Check back when your friends have played.'
  }, [error, feedMeta, loadingInitial])

  const showInviteFriendCta = !loadingInitial && !error && Boolean(feedMeta)

  const emptyDiagnostics = useMemo(() => {
    if (process.env.NODE_ENV === 'production' || !feedMeta) return null

    return [
      `has_friends=${String(feedMeta.has_friends)}`,
      `has_dismissed_domains=${String(feedMeta.has_dismissed_domains)}`,
      `total_item_count=${feedMeta.total_item_count}`,
      `pre_filter_active_count=${feedMeta.pre_filter_active_count}`,
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

  // Shared by the left-swipe and the on-card Dismiss button — one handler, one
  // animation. Plays the collapse, then swaps to the inline "Dismissed" bar.
  const requestDismiss = useCallback(
    (item: FeedApiItem) => {
      const itemId = item.id
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
    [reducedMotion, loadDismissedAnswer],
  )

  // Undo fully restores the card — no side effects, nothing learned.
  const undoDismiss = useCallback((itemId: string) => {
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
  }, [])

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
      setError(null)
      try {
        const response = await fetch(`/api/feed/${item.id}/answer`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ submitted_answer: submittedAnswer }),
        })
        const body = (await response.json().catch(() => null)) as
          | AnswerResponse
          | { message?: string }
          | null
        if (!response.ok || !body || !('isCorrect' in body)) {
          throw new Error(
            (body as { message?: string } | null)?.message ??
              'Could not submit that answer.'
          )
        }
        const isCorrect = Boolean(body.isCorrect)
        setResults((current) => ({
          ...current,
          [item.id]: {
            correct: isCorrect,
            answer: body.correctAnswer ?? '',
            submittedAnswer,
            explanation: body.explanation ?? null,
            quip: body.quip ?? null,
            insideJoke: body.insideJoke ?? null,
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
        setFeedbackSheetId(item.id)
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Could not submit that answer.'
        )
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

  return (
    <>
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

      {items.length === 0 ? (
        <section className="flex min-h-48 flex-col items-center justify-center gap-3 py-12 text-center">
          <p
            className={
              error
                ? 'text-destructive text-sm'
                : 'text-muted-foreground text-sm'
            }
          >
            {emptyCopy}
          </p>
          {showInviteFriendCta ? (
            <Link
              href="/friends"
              className="text-primary text-sm font-medium underline-offset-4 hover:underline"
            >
              Invite a friend
            </Link>
          ) : null}
          {emptyDiagnostics ? (
            <p className="bg-muted text-muted-foreground max-w-xl rounded px-3 py-2 font-mono text-xs break-words">
              {emptyDiagnostics}
            </p>
          ) : null}
        </section>
      ) : (
        <section className="space-y-3 pb-8">
          {groupItemsByRecency(items).map((group) => (
            <Fragment key={group.key}>
              <h2 className="text-muted-foreground/70 pt-4 text-[11px] font-medium tracking-[0.12em] uppercase first:pt-0">
                {group.label}
              </h2>
              {group.items.map((item) => {
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
                  const answeredItem = toAnsweredByYouItem(item, result)
                  const isIncorrect = answeredItem.isCorrect === false
                  const recheckAction: FeedRecheckAction | null = isIncorrect
                    ? { onSubmit: () => submitRecheck(item) }
                    : null
                  // direct_sent wrong answers stay re-attemptable (server
                  // allows the re-grade; clicking reopens the same answer
                  // sheet). Other source types still close on answer.
                  const onRetry =
                    isIncorrect && item.source_type === 'direct_sent'
                      ? () => setAnswerSheetId(item.id)
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

                const typedItem = toTypedFeedItem(item)
                // A friend_answered card the viewer already answered shows a
                // footer, not the Answer action — so it isn't dismissible.
                const viewerAnsweredFriendCard =
                  typedItem.type === 'friend_answered' &&
                  (typedItem.viewerResult ?? null) !== null
                const dismissible = !item.viewer_is_author && !viewerAnsweredFriendCard
                const onAnswer = dismissible ? () => setAnswerSheetId(item.id) : undefined
                const onDismiss = dismissible ? () => requestDismiss(item) : undefined

                let card: ReactNode
                if (typedItem.type === 'direct_sent') {
                  card = (
                    <DirectSentCard
                      item={typedItem}
                      overflow={overflow}
                      onAnswer={onAnswer}
                      onDismiss={onDismiss}
                    />
                  )
                } else if (typedItem.type === 'friend_added') {
                  card = (
                    <FriendAddedCard
                      item={typedItem}
                      overflow={overflow}
                      onAnswer={onAnswer}
                      onDismiss={onDismiss}
                      onHideCategory={() => void hideCategory(item)}
                    />
                  )
                } else if (typedItem.type === 'friend_liked') {
                  card = (
                    <FriendLikedCard
                      item={typedItem}
                      overflow={overflow}
                      onAnswer={onAnswer}
                      onDismiss={onDismiss}
                    />
                  )
                } else {
                  card = (
                    <FriendAnsweredCard
                      item={typedItem}
                      overflow={overflow}
                      onAnswer={onAnswer}
                      onDismiss={onDismiss}
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
              })}
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

      {answerSheetId ? (() => {
        const sheetItem = items.find((item) => item.id === answerSheetId)
        if (!sheetItem) return null
        return (
          <AnswerSheet
            question={sheetItem.question_text ?? ''}
            category={sheetItem.domain_pill}
            onSubmit={(answer) => void submitAnswer(sheetItem, answer)}
            onClose={() => setAnswerSheetId(null)}
            loading={busyId === sheetItem.id}
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
            quip={result.quip}
            insideJoke={result.insideJoke}
            openedNewTerritory={pickOpenedNewTerritory(result.masteryDelta)}
            openedTerritoryDomain={pickOpenedTerritoryDomain(result.masteryDelta)}
            questionId={sheetItem.question_id}
            feedItemId={sheetItem.id}
            onClose={() => setFeedbackSheetId(null)}
          />
        )
      })() : null}
    </>
  )
}

