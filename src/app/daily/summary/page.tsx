'use client'

import Link from 'next/link'
import { Flag, Heart, MoreHorizontal, X } from 'lucide-react'
import LoadingScreen from '@/components/LoadingScreen'
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react'

import { SendQuestionAction } from '@/components/SendQuestionAction'
import { AddToBankAction } from '@/components/AddToBankAction'
import { EditorialBadge } from '@/components/EditorialBadge'
import { CategoryGainsDisplay } from '@/components/review/CategoryGainsDisplay'
import MasteryMoment from '@/components/review/MasteryMoment'
import { RefineYourGame } from '@/components/review/RefineYourGame'
import { cn } from '@/lib/utils'
import { LLM_QUESTION_ATTRIBUTION } from '@/lib/questions-types'
import { formatNextResetTimeLocal } from '@/lib/games/timezone'
import type {
  DailySummaryView,
  QuestionRecap,
} from '@/server/db/queries/daily-summary'
import { RoundReminderCard } from './RoundReminderCard'

// useSyncExternalStore inputs for the client-only reset-time label. Hoisted so
// the subscribe/snapshot functions are stable across renders.
const subscribeNoop = () => () => {}
const getResetTimeSnapshot = () => formatNextResetTimeLocal()
const getResetTimeServerSnapshot = (): string | null => null

type FeedbackSignal = 'thumbs_up' | 'thumbs_down'


const DAILY_DIFFICULTY_LABELS: Record<string, string> = {
  normal: 'Establishing',
  moderate: 'Familiar',
  challenging: 'Solid',
  ridiculous: 'Mastery',
  adaptive: 'Adaptive',
}

function dailyDifficultyLabel(value: string | null | undefined): string | null {
  if (!value) return null
  return DAILY_DIFFICULTY_LABELS[value] ?? value
}

const monoStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.62rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
}

const titleStyle: CSSProperties = {
  fontFamily: 'var(--font-neutral), system-ui, sans-serif',
  fontSize: '0.8rem',
  fontWeight: 700,
  color: 'var(--brand-ink)',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

function formatTier(tier: string) {
  return tier.replace(/_/g, ' ').toUpperCase()
}

function interpretiveLine(summary: DailySummaryView): string | null {
  // 1. Tier crossing
  const crossing = summary.tierCrossings[0]
  if (crossing) {
    const domain =
      summary.domainGains.find((gain) => gain.domain === crossing.domain)
        ?.displayName ?? crossing.domain
    return `You moved to ${formatTier(crossing.toTier).toLowerCase()} in ${domain}.`
  }

  // 2. First correct in new demonstrated domain
  const newDomain = summary.domainGains.find((gain) => gain.isNewTerritory)
  if (newDomain) return `You found new ground in ${newDomain.displayName}.`

  const answered = summary.questions.filter((q) => !q.isSkipped)
  const total = answered.length

  // 3. 5/5
  if (total > 0 && summary.totalCorrect === total && total === 5)
    return 'Clean sweep.'

  // 4. 0/5
  if (total > 0 && summary.totalCorrect === 0 && total === 5)
    return 'Every one of them. Tomorrow.'

  // 5. 3+ correct in a row
  let streak = 0
  let maxStreak = 0
  for (const q of answered) {
    if (q.isCorrect) {
      streak += 1
      if (streak > maxStreak) maxStreak = streak
    } else {
      streak = 0
    }
  }
  if (maxStreak >= 3) return 'Three in a row at one point.'

  // 6. All wrong in a single domain
  const domainGroups = new Map<string, { total: number; wrong: number }>()
  for (const q of answered) {
    const key = q.domainDisplayName
    const entry = domainGroups.get(key) ?? { total: 0, wrong: 0 }
    entry.total += 1
    if (!q.isCorrect) entry.wrong += 1
    domainGroups.set(key, entry)
  }
  for (const [domain, counts] of domainGroups) {
    if (counts.total >= 2 && counts.wrong === counts.total) {
      return `${domain} is worth a deeper look.`
    }
  }

  return null
}

export default function DailySummaryPage() {
  const [summary, setSummary] = useState<DailySummaryView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Client-only reset-time label; null during SSR to keep hydration stable.
  const resetTime = useSyncExternalStore(
    subscribeNoop,
    getResetTimeSnapshot,
    getResetTimeServerSnapshot,
  )

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const response = await fetch('/api/daily/summary', {
          credentials: 'include',
          cache: 'no-store',
        })
        const body = await response.json().catch(() => null)
        if (!response.ok)
          throw new Error(body?.message ?? 'Could not load your daily summary.')
        if (!cancelled) setSummary(body as DailySummaryView)
      } catch (caught) {
        if (!cancelled)
          setError(
            caught instanceof Error
              ? caught.message
              : 'Could not load your daily summary.'
          )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const line = useMemo(
    () => (summary ? interpretiveLine(summary) : null),
    [summary]
  )
  const growthCircleItems = useMemo(() => {
    if (!summary) return []
    return summary.domainGains.map((gain) => ({
      canonical_subcategory: gain.displayName,
      broad_category: gain.broadCategory,
      points_total: gain.totalPoints,
      points_gained_this_round: gain.pointsGained,
      tier_current: gain.currentTier,
    }))
  }, [summary])
  const firstTierCrossing = summary?.tierCrossings[0] ?? null

  if (loading) {
    return <LoadingScreen fullScreen label="Loading summary" />
  }

  if (error || !summary) {
    return (
      <main className="mx-auto min-h-dvh max-w-3xl px-4 py-6">
        <p className="text-muted-foreground text-sm">
          {error ?? 'No summary is ready yet.'}
        </p>
        <Link className="btn-ghost mt-4" href="/">
          Back home
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-6">
      <header>
        <p style={{ ...monoStyle, color: 'var(--text-muted)' }}>
          <Link href="/" className="underline underline-offset-2">
            HOME
          </Link>
          {' / DAILY FIVE / SUMMARY'}
        </p>
        <h1 className="mt-2 font-serif text-[2rem] leading-tight text-[var(--brand-ink)]">
          How you did
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {formatDate(summary.date)}
        </p>
        <p
          style={{
            ...monoStyle,
            marginTop: '8px',
            color: 'var(--text-muted)',
          }}
        >
          {dailyDifficultyLabel(summary.difficultyMode)
            ? `${dailyDifficultyLabel(summary.difficultyMode)} · `
            : ''}
          {summary.totalCorrect}/{summary.questions.length} correct
          {summary.totalSkipped > 0 ? ` · ${summary.totalSkipped} skipped` : ''}
        </p>
      </header>

      <section className="card mt-5 px-5 py-4">
        <h2 style={titleStyle}>Your Growth Recap</h2>
        <CategoryGainsDisplay
          roundItems={growthCircleItems}
          emptyMessage="No mastery movement was recorded today."
        />
      </section>

      {summary.refine ? <RefineYourGame refine={summary.refine} /> : null}

      {firstTierCrossing ? (
        <MasteryMoment
          subcategory={
            summary.domainGains.find(
              (gain) => gain.domain === firstTierCrossing.domain
            )?.displayName ?? firstTierCrossing.domain
          }
          newTier={firstTierCrossing.toTier}
        />
      ) : null}

      {line ? <InterpretiveLine text={line} /> : null}

      <section className="mt-6">
        <h2 style={titleStyle}>Round Recap</h2>
        <div className="mt-3 space-y-3">
          {summary.questions.map((question) => (
            <QuestionCard key={question.questionId} question={question} />
          ))}
        </div>
      </section>

      {summary.reminderPromptState === 'show' ? <RoundReminderCard /> : null}

      <section className="card mt-5 px-5 py-4">
        <h2 style={titleStyle}>Tomorrow</h2>
        <p className="text-foreground mt-2 text-sm leading-6">
          {resetTime ? `Five new at ${resetTime}.` : 'Five new tomorrow.'}
        </p>
      </section>

      {summary.recentFriendBridge ? (
        <section className="card mt-5 px-5 py-4">
          <h2 style={titleStyle}>Meanwhile</h2>
          <p className="text-foreground mt-2 text-sm leading-6">
            {bridgeSentence(summary.recentFriendBridge)}
          </p>
          <Link className="btn-ghost mt-3" href="/#feed">
            See what they&apos;re up to →
          </Link>
        </section>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link className="btn-primary sm:flex-1" href="/">
          Back home
        </Link>
        <Link className="btn-ghost sm:flex-1" href="/knowledge">
          See your knowledge map
        </Link>
      </div>
    </main>
  )
}

function bridgeSentence(bridge: NonNullable<DailySummaryView['recentFriendBridge']>): string {
  const { friendName, cardType, domainDisplayName } = bridge
  const domain = domainDisplayName?.trim() || 'something new'
  switch (cardType) {
    case 'friend_answered':
      return `${friendName} answered ${domain}.`
    case 'friend_liked':
      return `${friendName} liked a question about ${domain}.`
    case 'friend_added':
      return `${friendName} just joined.`
    default:
      return `${friendName} is around today.`
  }
}

// B5/D9: on the summary page (unlike the gameplay chat, which stays plain text)
// author names link to the author's profile. Only human authors carry an
// authorId; house/editorial names render as plain text.
export function AuthorName({
  name,
  authorId,
  weight,
}: {
  name: string
  authorId: string | null
  weight?: number
}) {
  if (!authorId) {
    return <span style={{ fontWeight: weight }}>{name}</span>
  }
  return (
    <Link
      href={`/users/${encodeURIComponent(authorId)}`}
      style={{
        fontWeight: weight,
        color: 'var(--brand-link)',
        textDecoration: 'underline',
        textUnderlineOffset: 2,
      }}
    >
      {name}
    </Link>
  )
}

function InterpretiveLine({ text }: { text: string }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setVisible(true), 300)
    return () => window.clearTimeout(t)
  }, [])
  return (
    <p
      className="text-muted-foreground mt-4 text-sm leading-6 italic"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.4s ease' }}
    >
      {text}
    </p>
  )
}

function QuestionCard({ question }: { question: QuestionRecap }) {
  const [isOverflowOpen, setIsOverflowOpen] = useState(false)
  const [rating, setRating] = useState<FeedbackSignal | null>(null)
  const [isFeedbackPending, startFeedbackTransition] = useTransition()
  const [exclusionState, setExclusionState] = useState<ExclusionState>({
    kind: 'idle',
  })
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const updateFeedback = useCallback(
    (next: FeedbackSignal) => {
      const previous = rating
      const signal = previous === next ? null : next
      setRating(signal)

      if (!signal) return
      startFeedbackTransition(async () => {
        const response = await fetch('/api/daily/feedback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            generated_question_id: question.questionId,
            signal,
          }),
        })
        if (!response.ok) setRating(previous)
      })
    },
    [question.questionId, rating]
  )

  const handleExcludeDomain = useCallback(async () => {
    setIsOverflowOpen(false)
    setExclusionState({ kind: 'confirmed' })
    undoTimerRef.current = setTimeout(() => {
      undoTimerRef.current = null
    }, 5000)
    try {
      await fetch('/api/users/domain-exclusions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ canonical_subcategory: question.domain }),
      })
    } catch {
      // Optimistic UI is acceptable here; the next summary load will reflect persisted state.
    }
  }, [question.domain])

  const handleUndoExcludeDomain = useCallback(async () => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
    setExclusionState({ kind: 'undone' })
    try {
      await fetch(
        `/api/users/domain-exclusions/${encodeURIComponent(question.domain)}`,
        {
          method: 'DELETE',
          credentials: 'include',
        }
      )
    } catch {
      // Fire-and-forget; the affordance returns on reload if persistence failed.
    }
  }, [question.domain])

  const handleReportContent = useCallback(() => {
    updateFeedback('thumbs_down')
    setIsOverflowOpen(false)
  }, [updateFeedback])

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    }
  }, [])

  return (
    <article
      className="card relative p-5"
      style={
        question.isSkipped
          ? { borderLeft: '3px solid color-mix(in srgb, var(--brand-ink) 30%, transparent)' }
          : question.isCorrect
            ? {
                background: 'color-mix(in srgb, var(--success) 9%, var(--brand-card))',
                borderColor: 'color-mix(in srgb, var(--success) 30%, var(--brand-border))',
                borderLeft: '3px solid var(--success)',
              }
            : {
                background: 'color-mix(in srgb, #b42318 7%, var(--brand-card))',
                borderColor: 'color-mix(in srgb, #b42318 24%, var(--brand-border))',
                borderLeft: '3px solid #b42318',
              }
      }
    >
      <div className="flex flex-wrap items-start gap-2 pr-11">
        <span
          className="rounded-sm border px-2 py-1 text-[0.65rem] font-semibold tracking-[0.08em] uppercase"
          style={
            question.isSkipped
              ? { borderColor: 'var(--brand-border)', background: 'var(--secondary)', color: 'var(--brand-ink-400)' }
              : question.isCorrect
                ? {
                    borderColor: 'color-mix(in srgb, var(--success) 35%, var(--brand-border))',
                    background: 'color-mix(in srgb, var(--success) 14%, var(--brand-card))',
                    color: '#0f5c30',
                  }
                : {
                    borderColor: 'color-mix(in srgb, #b42318 35%, var(--brand-border))',
                    background: 'color-mix(in srgb, #b42318 12%, var(--brand-card))',
                    color: '#8b1f16',
                  }
          }
        >
          {question.isSkipped
            ? 'SKIPPED'
            : question.isCorrect
              ? 'CORRECT'
              : 'WRONG'}
        </span>
        <p className="pt-1" style={{ ...monoStyle, color: 'var(--text-muted)' }}>
          {question.authorName ? null : `${LLM_QUESTION_ATTRIBUTION.toUpperCase()} · ${question.domainDisplayName.toUpperCase()}`}
        </p>
        {question.authorName ? (
          <p
            className="pt-1"
            style={{
              fontFamily: 'var(--font-literata), ui-serif, Georgia, serif',
              fontSize: '0.86rem',
              color: 'var(--text)',
              lineHeight: 1.3,
              opacity: 0.92,
            }}
          >
            <span
              style={{
                ...monoStyle,
                fontSize: '0.55rem',
                color: 'var(--text-muted)',
                marginRight: '6px',
              }}
            >
              FROM
            </span>
            <AuthorName name={question.authorName} authorId={question.authorId} weight={600} />
            {question.authorIsHouse ? <EditorialBadge style={{ marginLeft: '6px' }} /> : null}
            <span
              style={{
                ...monoStyle,
                color: 'var(--text-muted)',
                marginLeft: '8px',
              }}
            >
              · {question.domainDisplayName.toUpperCase()}
            </span>
          </p>
        ) : null}
      </div>

      <button
        type="button"
        aria-label="More actions"
        aria-expanded={isOverflowOpen}
        onClick={() => setIsOverflowOpen(true)}
        className="text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground focus-visible:ring-ring absolute top-3 right-3 inline-flex size-11 items-center justify-center rounded-full border border-transparent transition focus-visible:ring-2 focus-visible:outline-none"
      >
        <MoreHorizontal className="size-5" />
      </button>

      <p className="text-foreground mt-4 leading-snug font-medium">
        {question.questionText}
      </p>
      <div className="mt-4 space-y-1 text-sm">
        <p className="text-muted-foreground">
          <span className="text-foreground font-medium">You:</span>{' '}
          {question.isSkipped
            ? 'skipped'
            : question.submittedAnswer?.trim() || 'No answer submitted'}
        </p>
        <p className="text-muted-foreground">
          <span className="text-foreground font-medium">Answer:</span>{' '}
          {question.correctAnswer || 'No answer available'}
        </p>
      </div>
      {question.explanation ? (
        <p className="bg-muted/35 text-muted-foreground mt-5 rounded-xl px-4 py-3 text-sm leading-6">
          {question.explanation}
        </p>
      ) : null}
      {question.authorNote ? (
        <p className="bg-muted/40 text-foreground mt-4 rounded-xl border p-3 text-sm leading-6">
          <span className="font-medium">
            {question.authorIsHouse ? (
              'Editor’s note:'
            ) : question.authorName ? (
              <>
                Why{' '}
                <AuthorName name={question.authorName} authorId={question.authorId} />{' '}
                asked:
              </>
            ) : (
              'Why they asked:'
            )}
          </span>{' '}
          {question.authorNote}
        </p>
      ) : null}
      {exclusionState.kind === 'confirmed' ? (
        <div className="bg-muted/35 text-muted-foreground mt-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs">
          <span>
            {question.domainDisplayName} won&apos;t appear in your daily queue
            anymore.
          </span>
          <button
            type="button"
            onClick={handleUndoExcludeDomain}
            className="ml-auto font-medium tracking-[0.08em] uppercase underline underline-offset-4"
          >
            Undo
          </button>
        </div>
      ) : null}
      <div className="border-border/50 mt-5 flex items-center justify-between border-t pt-3">
        <button
          aria-label="Love this question"
          aria-pressed={rating === 'thumbs_up'}
          className={cn(
            'text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring inline-flex size-11 items-center justify-center rounded-full transition focus-visible:ring-2 focus-visible:outline-none',
            rating === 'thumbs_up' ? 'bg-rose-50 text-rose-600' : ''
          )}
          disabled={isFeedbackPending}
          type="button"
          onClick={() => updateFeedback('thumbs_up')}
        >
          <Heart
            className={cn(
              'size-5 transition-transform',
              rating === 'thumbs_up' ? 'scale-110 fill-current' : ''
            )}
          />
        </button>
        <SendQuestionAction
          question={{
            id: question.questionId,
            text: question.questionText,
            domain: question.domainDisplayName,
          }}
          label=""
          className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring inline-flex size-11 items-center justify-center rounded-full transition focus-visible:ring-2 focus-visible:outline-none"
        />
      </div>

      {isOverflowOpen ? (
        <QuestionCardOverflowMenu
          question={question}
          onClose={() => setIsOverflowOpen(false)}
          onHideQuestionsLikeThis={handleExcludeDomain}
          onMuteCategory={handleExcludeDomain}
          onReportContent={handleReportContent}
          reportSelected={rating === 'thumbs_down'}
          reportDisabled={isFeedbackPending}
        />
      ) : null}
    </article>
  )
}

function QuestionCardOverflowMenu({
  question,
  onClose,
  onHideQuestionsLikeThis,
  onMuteCategory,
  onReportContent,
  reportSelected,
  reportDisabled,
}: {
  question: QuestionRecap
  onClose: () => void
  onHideQuestionsLikeThis: () => void
  onMuteCategory: () => void
  onReportContent: () => void
  reportSelected: boolean
  reportDisabled: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/20 px-3 pt-16 pb-3 sm:absolute sm:inset-auto sm:top-14 sm:right-3 sm:block sm:bg-transparent sm:p-0">
      <button
        className="absolute inset-0 cursor-default sm:hidden"
        type="button"
        aria-label="Close menu"
        onClick={onClose}
      />
      <div className="bg-background relative w-full max-w-md rounded-3xl border p-2 shadow-2xl sm:w-72 sm:rounded-2xl sm:shadow-xl">
        <div className="flex items-center justify-between px-3 py-2 sm:hidden">
          <p className="text-foreground text-sm font-medium">More actions</p>
          <button
            type="button"
            aria-label="Close menu"
            onClick={onClose}
            className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex size-11 items-center justify-center rounded-full"
          >
            <X className="size-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={onHideQuestionsLikeThis}
          className="text-foreground hover:bg-muted flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm transition"
        >
          Hide questions like this
        </button>
        <button
          type="button"
          onClick={onMuteCategory}
          className="text-foreground hover:bg-muted flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm transition"
        >
          Mute {question.domainDisplayName}
        </button>
        <button
          type="button"
          disabled
          className="text-muted-foreground/70 flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm"
        >
          Hide from feed
        </button>
        {question.bankQuestionId ? (
          <AddToBankAction
            questionId={question.bankQuestionId}
            initialInBank={question.isInBank}
            contextType="manual"
            label="Save to question bank"
            className="hover:bg-muted flex min-h-11 w-full justify-start rounded-xl border-0 px-3 text-left text-sm"
          />
        ) : null}
        <button
          type="button"
          onClick={onReportContent}
          disabled={reportDisabled}
          aria-pressed={reportSelected}
          className={cn(
            'text-muted-foreground hover:bg-muted hover:text-foreground flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm transition disabled:opacity-60',
            reportSelected ? 'bg-muted text-foreground' : ''
          )}
        >
          <Flag className="size-4" />
          Report content
        </button>
      </div>
    </div>
  )
}

type ExclusionState =
  | { kind: 'idle' }
  | { kind: 'confirmed' }
  | { kind: 'undone' }
