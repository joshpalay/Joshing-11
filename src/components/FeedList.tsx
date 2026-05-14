'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  AnsweredByYouCard,
  AnswerForm,
  DirectSentCard,
  FriendAddedCard,
  FriendAnsweredCard,
  FriendLikedCard,
  UnansweredFeedActions,
  type AnsweredByYouFeedItem,
  type DirectSentFeedItem,
  type FriendAddedFeedItem,
  type FriendAnsweredFeedItem,
  type FriendLikedFeedItem,
} from '@/components/feed'

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
  source_attribution: string
  source_result: 'correct' | 'incorrect' | null
  friend_results: FriendResult[] | null
  source_event_at: string
  personal_message: string | null
  state: string
  is_pinned: boolean
  question_text: string | null
  verified: boolean
  is_in_bank: boolean
  domain_pill: string | null
  difficulty: string | null
  explanation: string | null
  answer_result: 'correct' | 'incorrect' | null
  is_correct: boolean | null
  correct_answer: string | null
  submitted_answer: string | null
  awarded_points: number | null
  mastery_delta: unknown | null
  unverified_answer: boolean
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
  correct?: boolean
  isCorrect?: boolean
  answer?: string
  correctAnswer?: string
  explanation?: string | null
  quip?: string | null
  consolation?: string | null
  breadcrumb?: string | null
}

type ResultState = {
  correct: boolean
  answer: string
  explanation: string | null
  quip: string | null
  breadcrumb: string | null
}

function formatEventTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function comparisonCopy(
  playerCorrect: boolean | null,
  friendResults: FriendResult[] | null
): string {
  const primaryFriend = friendResults?.[0]
  const friendName = primaryFriend?.displayName ?? 'They'
  const friendCorrect = primaryFriend?.result === 'correct'

  if (playerCorrect === null) return 'You have already answered this question.'
  if (playerCorrect && friendCorrect) return 'You both had it.'
  if (playerCorrect && !friendCorrect)
    return `You found a connection ${friendName} missed.`
  if (!playerCorrect && friendCorrect)
    return `${friendName} recognized this one. You might next time.`
  return 'This one is still waiting for common ground.'
}

function feedMetadata(item: FeedApiItem) {
  const time = formatEventTime(item.source_event_at)
  return time ? `${item.source_attribution} · ${time}` : item.source_attribution
}

function baseTypedFields(item: FeedApiItem) {
  return {
    id: item.id,
    metadata: feedMetadata(item),
    category: item.domain_pill,
    question: item.question_text ?? 'Untitled question',
    personalMessage: item.personal_message,
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
    } satisfies DirectSentFeedItem
  }

  if (item.card_type === 'friend_added') {
    return {
      ...base,
      type: 'friend_added' as const,
      friendName: item.source_friend_display_name,
    } satisfies FriendAddedFeedItem
  }

  if (item.card_type === 'friend_liked') {
    return {
      ...base,
      type: 'friend_liked' as const,
      friendName: item.source_friend_display_name,
    } satisfies FriendLikedFeedItem
  }

  return {
    ...base,
    type: 'friend_answered' as const,
    friendName:
      item.friend_results?.[0]?.displayName ?? item.source_friend_display_name,
    friendCorrect:
      item.friend_results?.[0]?.result === 'correct' ||
      item.source_result === 'correct',
    answerSummary: friendAnsweredSummary(item),
  } satisfies FriendAnsweredFeedItem
}

function toAnsweredByYouItem(
  item: FeedApiItem,
  result?: ResultState
): AnsweredByYouFeedItem {
  return {
    ...baseTypedFields(item),
    type: 'answered_by_you',
    resultLabel:
      item.is_correct === false ? 'Answered by you · Not quite' : 'Answered by you',
    answerSummary: result
      ? comparisonCopy(result.correct, item.friend_results)
      : comparisonCopy(item.is_correct, item.friend_results),
  }
}

type FeedListProps = {
  pageSize?: number
  infinite?: boolean
}

type QuestionCardState = 'unanswered' | 'answering' | 'answered' | 'reacted'

export default function FeedList({
  pageSize = 20,
  infinite = false,
}: FeedListProps) {
  const searchParams = useSearchParams()
  const feedFilterParam =
    searchParams.get('filter') ?? searchParams.get('feed_filter') ?? 'all'
  const feedFilter: FeedFilter =
    feedFilterParam === 'sent-to-me' || feedFilterParam === 'from-friends'
      ? feedFilterParam
      : 'all'
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const [items, setItems] = useState<FeedApiItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [feedMeta, setFeedMeta] = useState<FeedMeta | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [results, setResults] = useState<Record<string, ResultState>>({})
  const [cardStates, setCardStates] = useState<
    Record<string, QuestionCardState>
  >({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ceremonyBanner, setCeremonyBanner] = useState<CeremonyBanner | null>(
    null
  )

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

  const visibleItems = items

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

  const updateState = useCallback(
    async (itemId: string, state: 'skipped' | 'dismissed') => {
      setBusyId(itemId)
      setError(null)
      try {
        const response = await fetch(`/api/feed/${itemId}/state`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ state }),
        })
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          throw new Error(body?.message ?? 'Could not update that Feed item.')
        }
        removeItem(itemId)
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Could not update that Feed item.'
        )
      } finally {
        setBusyId(null)
      }
    },
    [removeItem]
  )

  const submitAnswer = useCallback(
    async (item: FeedApiItem) => {
      const submitted = answers[item.id]?.trim()
      if (!submitted) return
      setBusyId(item.id)
      setError(null)
      try {
        const response = await fetch(`/api/feed/${item.id}/answer`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ submitted_answer: submitted }),
        })
        const body = (await response.json().catch(() => null)) as
          | AnswerResponse
          | { message?: string }
          | null
        if (
          !response.ok ||
          !body ||
          !('correct' in body || 'isCorrect' in body)
        ) {
          throw new Error(
            (body as { message?: string } | null)?.message ??
              'Could not submit that answer.'
          )
        }
        setResults((current) => ({
          ...current,
          [item.id]: {
            correct: Boolean(body.correct ?? body.isCorrect),
            answer: body.answer ?? body.correctAnswer ?? '',
            explanation: body.explanation ?? null,
            quip: body.quip ?? body.consolation ?? null,
            breadcrumb: body.breadcrumb ?? null,
          },
        }))
        setCardStates((s) => ({ ...s, [item.id]: 'answered' }))
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
    [answers]
  )

  return (
    <>
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

      {visibleItems.length === 0 ? (
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
          {/*
            // v11.1: Joshing Game creation disabled at FAB level. Re-enable
            // when game creation flow is restored.
          */}
        </section>
      ) : (
        <section className="space-y-3 pb-8">
          {visibleItems.map((item) => {
            const result = results[item.id]
            const cardState =
              cardStates[item.id] ??
              (item.state === 'answered' ? 'answered' : 'unanswered')
            const answeredByYouItem =
              cardState === 'answered'
                ? toAnsweredByYouItem(item, result)
                : null
            const typedItem = toTypedFeedItem(item)
            const isBusy = busyId === item.id
            const answerActions =
              cardState === 'answering' ? (
                <AnswerForm
                  value={answers[item.id] ?? ''}
                  onChange={(value) =>
                    setAnswers((current) => ({ ...current, [item.id]: value }))
                  }
                  onSubmit={() => void submitAnswer(item)}
                  onCancel={() =>
                    setCardStates((state) => ({
                      ...state,
                      [item.id]: 'unanswered',
                    }))
                  }
                  disabled={isBusy}
                />
              ) : cardState === 'unanswered' ? (
                <UnansweredFeedActions
                  onAnswer={() =>
                    setCardStates((state) => ({
                      ...state,
                      [item.id]: 'answering',
                    }))
                  }
                  onDismiss={() => void updateState(item.id, 'dismissed')}
                  disabled={isBusy}
                />
              ) : null

            const answeredDetails = result || cardState === 'answered' ? (
              <div className="rounded-xl bg-white/60 p-3 text-sm leading-6 text-stone-700">
                <p className="font-medium text-stone-900">
                  {comparisonCopy(result?.correct ?? item.is_correct, item.friend_results)}
                </p>
                {item.submitted_answer || answers[item.id] ? (
                  <p className="mt-1">Your answer: {item.submitted_answer || answers[item.id]}</p>
                ) : null}
                {(result?.answer || item.correct_answer) &&
                (result?.correct === false || item.is_correct === false) ? (
                  <p className="mt-1">
                    Answer: {result?.answer || item.correct_answer}
                  </p>
                ) : null}
                {typeof item.awarded_points === 'number' ? (
                  <p className="mt-1">Points: +{item.awarded_points}</p>
                ) : null}
                {item.unverified_answer ? (
                  <p className="text-muted-foreground mt-1">This answer is still unverified.</p>
                ) : null}
                {result?.explanation || item.explanation ? (
                  <p className="text-muted-foreground mt-1">
                    {result?.explanation || item.explanation}
                  </p>
                ) : null}
                {result?.quip ? (
                  <p className="text-muted-foreground mt-1">{result.quip}</p>
                ) : null}
                {result?.breadcrumb ? (
                  <p className="text-muted-foreground mt-2 italic">
                    {result.breadcrumb}
                  </p>
                ) : null}
              </div>
            ) : null

            if (answeredByYouItem) {
              return (
                <AnsweredByYouCard key={item.id} item={answeredByYouItem}>
                  {answeredDetails}
                </AnsweredByYouCard>
              )
            }

            if (typedItem.type === 'direct_sent') {
              return (
                <DirectSentCard
                  key={item.id}
                  item={typedItem}
                  actions={answerActions}
                />
              )
            }

            if (typedItem.type === 'friend_added') {
              return (
                <FriendAddedCard
                  key={item.id}
                  item={typedItem}
                  actions={answerActions}
                />
              )
            }

            if (typedItem.type === 'friend_liked') {
              return (
                <FriendLikedCard
                  key={item.id}
                  item={typedItem}
                  actions={answerActions}
                />
              )
            }

            return (
              <FriendAnsweredCard
                key={item.id}
                item={typedItem}
                actions={answerActions}
              />
            )
          })}
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
    </>
  )
}
