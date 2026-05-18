'use client'

import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  AnsweredByYouCard,
  AnswerFeedbackSheet,
  AnswerSheet,
  DirectSentCard,
  FeedOverflowMenu,
  FriendAddedCard,
  FriendAnsweredCard,
  FriendLikedCard,
  type AnsweredByYouFeedItem,
  type DirectSentFeedItem,
  type FeedRecheckAction,
  type FriendAddedFeedItem,
  type FriendAnsweredFeedItem,
  type FriendLikedFeedItem,
} from '@/components/feed'
import { formatRelativeTime, groupItemsByRecency } from '@/components/feed/visual'

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
  type?:
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
  source_result: 'correct' | 'incorrect' | null
  friend_results: FriendResult[] | null
  viewer_answer_status?: { result: 'correct' | 'incorrect' } | null
  endorsement_count?: number | null
  additional_endorsers?: Array<{ userId: string; displayName: string }> | null
  source_event_at: string
  personal_message: string | null
  state: string
  is_pinned: boolean
  question_text: string | null
  verified: boolean
  is_in_bank: boolean
  domain_pill: string | null
  broad_category?: string | null
  difficulty: string | null
  explanation: string | null
  answer_result: 'correct' | 'incorrect' | null
  is_correct: boolean | null
  correct_answer: string | null
  submitted_answer: string | null
  awarded_points: number | null
  pointsAwarded?: number | null
  mastery_delta: unknown | null
  unverified_answer: boolean
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

type CeremonyBanner = {
  id: string
  firedAt: string
}

type AnswerResponse = {
  isCorrect?: boolean
  correctAnswer?: string
  explanation?: string | null
  quip?: string | null
  breadcrumb?: string | null
  pointsAwarded?: number | null
  masteryDelta?: unknown | null
}

type ResultState = {
  correct: boolean
  answer: string
  submittedAnswer: string
  explanation: string | null
  quip: string | null
  breadcrumb: string | null
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
      className="font-semibold text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-stone-700"
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
          item.friend_results,
          item.source_type,
          item.source_friend_display_name,
          item.source_user_id
        )
      : comparisonCopy(
          item.is_correct,
          item.friend_results,
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
    unverifiedAnswer: item.unverified_answer,
    broadCategory: pickBroadCategory(masteryDeltaRaw, item),
    masteryDelta: normalizeMasteryDelta(masteryDeltaRaw),
    pairedFriend: pickPairedFriend(item),
  }
}

type FeedListProps = {
  pageSize?: number
  infinite?: boolean
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
}: FeedListProps) {
  const searchParams = useSearchParams()
  const initialFilterParam =
    searchParams.get('filter') ?? searchParams.get('feed_filter') ?? 'all'
  const initialFilter: FeedFilter =
    initialFilterParam === 'sent-to-me' || initialFilterParam === 'from-friends'
      ? initialFilterParam
      : 'all'
  const [feedFilter, setFeedFilter] = useState<FeedFilter>(initialFilter)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const [items, setItems] = useState<FeedApiItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [feedMeta, setFeedMeta] = useState<FeedMeta | null>(null)
  const [results, setResults] = useState<Record<string, ResultState>>({})
  const [cardStates, setCardStates] = useState<Record<string, QuestionCardState>>({})
  const [answerSheetId, setAnswerSheetId] = useState<string | null>(null)
  const [feedbackSheetId, setFeedbackSheetId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ceremonyBanner, setCeremonyBanner] = useState<CeremonyBanner | null>(null)

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

        if (!isNextPage) {
          const bannerResponse = await fetch('/api/ceremony/banner', {
            cache: 'no-store',
            credentials: 'include',
          })
          const bannerBody = (await bannerResponse
            .json()
            .catch(() => null)) as { ceremony?: CeremonyBanner | null } | null
          setCeremonyBanner(
            bannerResponse.ok ? (bannerBody?.ceremony ?? null) : null
          )
        }
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
      return 'When friends recognize each other’s questions, those moments will appear here.'
    // pre_filter_active_count > 0 means items exist in active/skipped state but are hidden by domain filters
    if (
      feedMeta.has_dismissed_domains &&
      feedMeta.pre_filter_active_count > 0
    ) {
      return "You've focused your Feed. You can re-open domains from your Knowledge page."
    }
    if (feedMeta.total_item_count > 0)
      return "You're caught up. Answer questions to reveal more common ground."
    return 'Answer questions to reveal common ground.'
  }, [error, feedMeta, loadingInitial])

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
    setBusyId(item.id)
    setError(null)
    try {
      const response = await fetch('/api/feed/dismiss-domain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ domain: item.domain_pill }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.message ?? 'Could not hide that category.')
      }
      setItems((current) =>
        current.filter(
          (currentItem) => currentItem.domain_pill !== item.domain_pill
        )
      )
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
        removeItem(item.id)
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
    [removeItem]
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
            breadcrumb: body.breadcrumb ?? null,
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

  const filterOptions: Array<{ value: FeedFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'sent-to-me', label: 'Sent to me' },
    { value: 'from-friends', label: 'From friends' },
  ]

  return (
    <>
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Feed filters">
        {filterOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setFeedFilter(option.value)}
            aria-current={feedFilter === option.value ? 'page' : undefined}
            className={
              feedFilter === option.value
                ? 'rounded-full bg-stone-950 px-3 py-1.5 text-sm font-medium text-white'
                : 'rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50'
            }
          >
            {option.label}
          </button>
        ))}
      </nav>
      {ceremonyBanner ? (
        <Link
          href={`/ceremony/${ceremonyBanner.id}`}
          className="mb-4 block rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-stone-950 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-lg" aria-hidden>
              ✦
            </span>
            <div>
              <p className="font-medium">Your two-week reflection is ready</p>
              <p className="mt-1 text-sm text-stone-700">
                See what you&rsquo;ve been up to {'->'}
              </p>
            </div>
          </div>
        </Link>
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
              <h2 className="text-muted-foreground pt-4 text-xs font-semibold tracking-[0.18em] uppercase first:pt-0">
                {group.label}
              </h2>
              {group.items.map((item) => {
                const result = results[item.id]
                const cardState =
                  cardStates[item.id] ??
                  (item.state === 'answered' ? 'answered' : 'unanswered')
                const isAnswered = cardState === 'answered'
                const isBusy = busyId === item.id

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
                  return (
                    <AnsweredByYouCard
                      key={item.id}
                      item={answeredItem}
                      recheckAction={recheckAction}
                      overflow={overflow}
                    />
                  )
                }

                const onAnswer = item.viewer_is_author ? undefined : () => setAnswerSheetId(item.id)
                const typedItem = toTypedFeedItem(item)

                if (typedItem.type === 'direct_sent') {
                  return (
                    <DirectSentCard
                      key={item.id}
                      item={typedItem}
                      overflow={overflow}
                      onAnswer={onAnswer}
                    />
                  )
                }

                if (typedItem.type === 'friend_added') {
                  return (
                    <FriendAddedCard
                      key={item.id}
                      item={typedItem}
                      overflow={overflow}
                      onAnswer={onAnswer}
                      onHideCategory={() => void hideCategory(item)}
                    />
                  )
                }

                if (typedItem.type === 'friend_liked') {
                  return (
                    <FriendLikedCard
                      key={item.id}
                      item={typedItem}
                      overflow={overflow}
                      onAnswer={onAnswer}
                    />
                  )
                }

                return (
                  <FriendAnsweredCard
                    key={item.id}
                    item={typedItem}
                    overflow={overflow}
                    onAnswer={onAnswer}
                  />
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
            questionId={sheetItem.question_id}
            feedItemId={sheetItem.id}
            onClose={() => setFeedbackSheetId(null)}
          />
        )
      })() : null}
    </>
  )
}
