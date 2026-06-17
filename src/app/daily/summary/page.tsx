'use client'

import Link from 'next/link'
import { Heart, MoreHorizontal, Share2, X } from 'lucide-react'
import LoadingScreen from '@/components/LoadingScreen'
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'

import { SendQuestionAction } from '@/components/SendQuestionAction'
import { AddToBankAction } from '@/components/AddToBankAction'
import { AuthorName } from '@/components/AuthorName'
import { EditorialBadge } from '@/components/EditorialBadge'
import { CategoryGainsDisplay } from '@/components/review/CategoryGainsDisplay'
import MasteryMoment from '@/components/review/MasteryMoment'
import { RefineYourGame } from '@/components/review/RefineYourGame'
import { cn } from '@/lib/utils'
import { LLM_QUESTION_ATTRIBUTION } from '@/lib/questions-types'
import { CreatorNote, pickCreatorNote } from '@/components/CreatorNote'
import type {
  DailySummaryView,
  QuestionRecap,
} from '@/server/db/queries/daily-summary'
import { RoundReminderCard } from './RoundReminderCard'
import { FirstSessionPanel } from './FirstSessionPanel'
import type { FirstSessionRecapView } from '@/server/daily/first-session-recap'
import { ReportReasonSheet, type ReportReasonTarget } from '@/components/report/ReportReasonSheet'

// The heart is the only feedback signal on the recap now; the negative surface is
// the ⋯ report items (B-Report-2). The /api/daily/feedback route still accepts the
// other signal for the separate feed thumbs-down, which this page no longer sends.
type FeedbackSignal = 'thumbs_up'


const titleStyle: CSSProperties = {
  fontFamily: 'var(--font-neutral), system-ui, sans-serif',
  fontSize: '0.8rem',
  fontWeight: 700,
  color: 'var(--brand-ink)',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
}

export default function DailySummaryPage() {
  const [summary, setSummary] = useState<DailySummaryView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // B-FirstRecap-1: the one-time first-session panel shown inline at the top of
  // this summary on the user's first completed Daily Five. Null unless eligible
  // + not yet seen.
  const [firstSessionRecap, setFirstSessionRecap] =
    useState<FirstSessionRecapView | null>(null)
  // B-Report-2: recap rows the player removed by reporting them as inappropriate.
  // View-state only this prompt — durable self-hide is B-Report-3.
  const [hiddenQuestionIds, setHiddenQuestionIds] = useState<Set<string>>(
    () => new Set(),
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

  // B-FirstRecap-1: fetch the first-session recap. The endpoint returns
  // { recap: null } unless this is the user's first completed round and the
  // recap has not been seen, so this is a no-op for everyone else.
  useEffect(() => {
    let cancelled = false
    fetch('/api/daily/first-session-recap', {
      credentials: 'include',
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) return
        const body = await response.json().catch(() => null)
        if (!cancelled && body?.recap) {
          setFirstSessionRecap(body.recap as FirstSessionRecapView)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const headerDomain = useMemo(
    () => (summary ? summaryHeadlineDomain(summary) : 'today’s questions'),
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
  const line = useMemo(
    () => (summary ? interpretiveLine(summary) : null),
    [summary]
  )
  // The next Daily Five arrives at noon tomorrow; name the weekday (e.g. "Monday")
  // rather than saying "Tomorrow" so the copy reads concretely.
  const tomorrowWeekday = useMemo(() => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    return tomorrow.toLocaleDateString(undefined, { weekday: 'long' })
  }, [])

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
    <main className="min-h-dvh bg-[var(--brand-cream-page)] px-4 py-6 text-[var(--brand-ink)]">
      <div className="relative mx-auto max-w-3xl">
        <Link
          href="/"
          aria-label="Close session recap"
          className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring absolute top-0 right-0 z-10 inline-flex size-10 items-center justify-center rounded-full transition focus-visible:ring-2 focus-visible:outline-none"
        >
          <X className="size-5" />
        </Link>
        {/* B-FirstRecap-1: greet first-time players before anything else — the
            congrats panel is the very first thing on the page on their first
            completed round. */}
        {firstSessionRecap ? <FirstSessionPanel recap={firstSessionRecap} /> : null}

        <header className={cn('pb-2', firstSessionRecap && 'mt-8')}>
          <Link
            href="/"
            className="text-muted-foreground inline-flex min-h-9 items-center text-sm font-medium underline-offset-4 transition hover:text-foreground hover:underline"
          >
            Session recap
          </Link>
          <div className="mt-4 flex items-start justify-between gap-4">
            <div>
              <h1 className="font-serif text-[2.75rem] leading-[0.95] tracking-[-0.03em] text-[var(--brand-ink)] sm:text-5xl">
                Today&rsquo;s Five
              </h1>
              <p className="mt-4 max-w-xl text-[1.02rem] leading-7 text-[var(--brand-ink-700)]">
                You found common ground in {headerDomain} and opened a few new
                edges of the map.
              </p>
            </div>
            <p
              className="shrink-0 pt-2 text-sm font-medium text-[var(--brand-ink-400)]"
              aria-label={`${summary.totalCorrect} out of ${summary.questions.length} correct`}
            >
              {summary.totalCorrect} / {summary.questions.length}
            </p>
          </div>
          <div className="mt-5 flex items-center justify-between gap-3">
            <ResultDots questions={summary.questions} />
            <ShareResultsButton correct={summary.totalCorrect} total={summary.questions.length} />
          </div>
          {line ? <InterpretiveLine text={line} /> : null}
        </header>

        <section className="mt-8 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-card)] px-5 py-4">
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

        <section className="mt-8">
          <div className="mb-4">
            <h2 className="font-serif text-2xl leading-tight text-[var(--brand-ink)]">
              Today&rsquo;s questions
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              A few were yours. A few were new.
            </p>
          </div>
          <div className="space-y-4">
            {summary.questions
              .filter((question) => !hiddenQuestionIds.has(question.questionId))
              .map((question) => (
                <QuestionCard
                  key={question.questionId}
                  question={question}
                  onHide={() =>
                    setHiddenQuestionIds((prev) => {
                      const next = new Set(prev)
                      next.add(question.questionId)
                      return next
                    })
                  }
                />
              ))}
          </div>
        </section>

        {summary.reminderPromptState === 'show' && !firstSessionRecap ? (
          <RoundReminderCard />
        ) : null}

        {summary.recentFriendBridge ? (
          <section className="mt-6 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-card)] px-5 py-4">
            <h2 style={titleStyle}>Meanwhile</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--brand-ink-700)]">
              {bridgeSentence(summary.recentFriendBridge)}
            </p>
            <Link
              className="mt-3 inline-flex text-sm font-medium text-[var(--brand-link)] underline underline-offset-4"
              href="/#feed"
            >
              See what they&apos;re up to →
            </Link>
          </section>
        ) : null}

        <section className="mt-8 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-card)] px-5 py-6 text-center">
          <p className="text-[1.05rem] leading-7 text-[var(--brand-ink-700)]">
            {tomorrowWeekday}’s five arrive at noon.
          </p>
          <div className="mt-5 flex flex-col items-center gap-3">
            <Link className="btn-primary w-full sm:w-auto sm:min-w-56" href="/">
              Back home
            </Link>
            <Link
              className="text-muted-foreground text-sm font-medium underline underline-offset-4 transition hover:text-foreground"
              href="/knowledge"
            >
              See your knowledge map
            </Link>
          </div>
        </section>
      </div>
    </main>
  )
}


function summaryHeadlineDomain(summary: DailySummaryView): string {
  const correctDomain = summary.questions.find(
    (question) => question.isCorrect && question.domainDisplayName.trim(),
  )?.domainDisplayName
  if (correctDomain) return correctDomain

  const gainedDomain = summary.domainGains[0]?.displayName
  if (gainedDomain) return gainedDomain

  return summary.questions[0]?.domainDisplayName || 'today’s questions'
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

function ResultDots({ questions }: { questions: QuestionRecap[] }) {
  return (
    <div className="flex items-center gap-2" aria-label="Question results">
      {questions.map((question, index) => (
        <span
          key={question.questionId}
          className="size-2.5 rounded-full border"
          style={{
            backgroundColor: question.isSkipped
              ? 'color-mix(in srgb, var(--brand-ink) 24%, transparent)'
              : question.isCorrect
                ? 'color-mix(in srgb, var(--game-correct) 88%, var(--brand-card))'
                : 'color-mix(in srgb, var(--game-wrong) 78%, var(--brand-card))',
            borderColor: 'color-mix(in srgb, var(--brand-border) 72%, transparent)',
            boxShadow: '0 0 0 2px var(--brand-card)',
          }}
          aria-label={`Question ${index + 1}: ${
            question.isSkipped ? 'skipped' : question.isCorrect ? 'correct' : 'not this time'
          }`}
        />
      ))}
    </div>
  )
}

function ShareResultsButton({ correct, total }: { correct: number; total: number }) {
  const [copied, setCopied] = useState(false)

  const share = useCallback(async () => {
    const text = `I got ${correct}/${total} on today’s Joshing Five.`
    if (typeof navigator === 'undefined') return
    if ('share' in navigator) {
      await navigator.share({ title: 'Today’s Five', text }).catch(() => undefined)
      return
    }
    const clipboard = (navigator as Navigator & { clipboard?: Clipboard }).clipboard
    if (clipboard) {
      await clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    }
  }, [correct, total])

  return (
    <button
      type="button"
      onClick={() => void share()}
      className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--brand-border)] bg-[var(--brand-card)] px-3 text-sm font-medium text-[var(--brand-ink-700)] transition hover:bg-[var(--brand-cream-page)] hover:text-[var(--brand-ink)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Share2 className="size-4" />
      {copied ? 'Copied' : 'Share your results'}
    </button>
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


function QuestionCard({ question, onHide }: { question: QuestionRecap; onHide: () => void }) {
  const [isOverflowOpen, setIsOverflowOpen] = useState(false)
  const [rating, setRating] = useState<FeedbackSignal | null>(null)
  const [isFeedbackPending, startFeedbackTransition] = useTransition()
  const [exclusionState, setExclusionState] = useState<ExclusionState>({
    kind: 'idle',
  })
  // B-Report-2: which "why" sheet is open, if any. Null = no sheet.
  const [reportCategory, setReportCategory] = useState<'incorrect' | 'inappropriate' | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const updateFeedback = useCallback(
    (next: FeedbackSignal) => {
      const previous = rating
      const signal = previous === next ? null : next
      setRating(signal)

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

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    }
  }, [])

  const [isExplainerOpen, setIsExplainerOpen] = useState(false)
  const statusLabel = question.isSkipped
    ? 'Skipped'
    : question.isCorrect
      ? 'Correct'
      : 'Not this time'
  const authorLabel = question.authorName ?? LLM_QUESTION_ATTRIBUTION
  const note = pickCreatorNote({
    isHuman: Boolean(question.authorName) && !question.authorIsHouse,
    authorName: question.authorName,
    creatorNote: question.authorNote,
  })

  return (
    <article className="relative overflow-hidden rounded-lg border border-[var(--brand-border)] bg-[var(--brand-card)] p-5 shadow-none">
      <div
        className="absolute inset-y-0 left-0 w-1"
        style={{
          backgroundColor: question.isSkipped
            ? 'color-mix(in srgb, var(--brand-ink) 26%, var(--brand-card))'
            : question.isCorrect
              ? 'var(--game-correct)'
              : 'color-mix(in srgb, var(--game-wrong) 76%, var(--brand-card))',
        }}
      />

      <div className="flex items-start justify-between gap-3 pl-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold tracking-[0.05em]"
              style={{
                borderColor: question.isCorrect
                  ? 'color-mix(in srgb, var(--game-correct) 28%, var(--brand-border))'
                  : 'var(--brand-border)',
                backgroundColor: question.isCorrect
                  ? 'color-mix(in srgb, var(--game-correct) 8%, var(--brand-card))'
                  : 'color-mix(in srgb, var(--brand-cream-page) 62%, var(--brand-card))',
                color: question.isCorrect ? 'var(--game-correct)' : 'var(--brand-ink-700)',
              }}
            >
              {statusLabel}
            </span>
            <p className="text-xs leading-5 text-muted-foreground">
              <span>{question.domainDisplayName}</span>
              <span aria-hidden="true"> · </span>
              <span>by </span>
              {question.authorName ? (
                <AuthorName name={question.authorName} authorId={question.authorId} weight={500} />
              ) : (
                <span>{authorLabel}</span>
              )}
              {question.authorIsHouse ? <EditorialBadge style={{ marginLeft: '6px' }} /> : null}
            </p>
          </div>
        </div>

        <button
          type="button"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={isOverflowOpen}
          onClick={() => setIsOverflowOpen((open) => !open)}
          className="text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:ring-ring -mr-2 -mt-2 inline-flex size-10 shrink-0 items-center justify-center rounded-full transition focus-visible:ring-2 focus-visible:outline-none"
        >
          <MoreHorizontal className="size-5" />
        </button>
      </div>

      <p className="mt-4 pl-1 text-[1.12rem] leading-7 font-medium tracking-[-0.01em] text-[var(--brand-ink)]">
        {question.questionText}
      </p>

      <div className="mt-5 grid gap-3 rounded-md border border-[var(--brand-border)] bg-[var(--brand-cream-page)] p-3 sm:grid-cols-2">
        <div>
          <p className="text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            You said
          </p>
          <p className="mt-1 text-sm leading-6 text-[var(--brand-ink)]">
            {question.isSkipped
              ? 'Skipped'
              : question.submittedAnswer?.trim() || 'No answer submitted'}
          </p>
        </div>
        <div className="border-t border-[var(--brand-border)] pt-3 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-3">
          <p className="text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Answer
          </p>
          <p
            className="mt-1 text-sm leading-6 font-medium"
            style={{ color: question.isCorrect ? 'var(--game-correct)' : 'var(--brand-ink)' }}
          >
            {question.correctAnswer || 'No answer available'}
          </p>
        </div>
      </div>

      {question.explanation ? (
        <section className="mt-5 pl-1">
          <h3 className="text-sm font-semibold text-[var(--brand-ink)]">
            Why this is the answer
          </h3>
          <p
            className="mt-2 text-sm leading-6 text-[var(--brand-ink-700)]"
            style={
              isExplainerOpen
                ? undefined
                : {
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }
            }
          >
            {question.explanation}
          </p>
          {!isExplainerOpen ? (
            <button
              type="button"
              onClick={() => setIsExplainerOpen(true)}
              className="mt-2 text-sm font-medium text-[var(--brand-link)] underline underline-offset-4"
            >
              More context →
            </button>
          ) : null}
        </section>
      ) : null}

      {note ? <CreatorNote text={note.text} provenance={note.provenance} /> : null}

      {exclusionState.kind === 'confirmed' ? (
        <div className="bg-muted/35 text-muted-foreground mt-4 flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
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

      <div className="mt-5 flex flex-wrap items-center gap-1 border-t border-[var(--brand-border)] pt-3 text-muted-foreground">
        {question.bankQuestionId ? (
          <AddToBankAction
            questionId={question.bankQuestionId}
            initialInBank={question.isInBank}
            contextType="manual"
            label="Save"
            className="min-h-9 rounded-full border-0 bg-transparent px-2.5 text-xs hover:bg-muted"
          />
        ) : null}
        <button
          aria-label="Love this question"
          aria-pressed={rating === 'thumbs_up'}
          className={cn(
            'inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-xs transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            rating === 'thumbs_up' ? 'bg-[var(--brand-cream-page)] text-[var(--brand-orange)]' : ''
          )}
          disabled={isFeedbackPending}
          type="button"
          onClick={() => updateFeedback('thumbs_up')}
        >
          <Heart className={cn('size-4', rating === 'thumbs_up' ? 'fill-current' : '')} />
          React
        </button>
        <SendQuestionAction
          question={{
            id: question.questionId,
            text: question.questionText,
            domain: question.domainDisplayName,
          }}
          label="Share"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
      </div>

      {isOverflowOpen ? (
        <QuestionCardOverflowMenu
          question={question}
          onClose={() => setIsOverflowOpen(false)}
          onHideQuestionsLikeThis={handleExcludeDomain}
          onMuteCategory={handleExcludeDomain}
          canReport={question.reportTarget !== null}
          onReportIncorrect={() => {
            setIsOverflowOpen(false)
            setReportCategory('incorrect')
          }}
          onReportInappropriate={() => {
            setIsOverflowOpen(false)
            setReportCategory('inappropriate')
          }}
        />
      ) : null}

      {reportCategory && question.reportTarget ? (
        <ReportReasonSheet
          category={reportCategory}
          target={question.reportTarget as ReportReasonTarget}
          surface="round_recap"
          onClose={() => setReportCategory(null)}
          onSubmitted={(category) => {
            if (category === 'inappropriate') onHide()
          }}
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
  canReport,
  onReportIncorrect,
  onReportInappropriate,
}: {
  question: QuestionRecap
  onClose: () => void
  onHideQuestionsLikeThis: () => void
  onMuteCategory: () => void
  canReport: boolean
  onReportIncorrect: () => void
  onReportInappropriate: () => void
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
        {canReport ? (
          <>
            <button
              type="button"
              onClick={onReportIncorrect}
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm transition"
            >
              This is incorrect
            </button>
            <button
              type="button"
              onClick={onReportInappropriate}
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm transition"
            >
              This is inappropriate
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}

type ExclusionState =
  | { kind: 'idle' }
  | { kind: 'confirmed' }
  | { kind: 'undone' }
