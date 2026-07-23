'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'

import { AnswerSheet, visibleFeedCategory } from '@/components/feed'
import { FeedActionLink } from '@/components/feed/FeedActionLink'
import { difficultyCopyFromEstimate } from '@/lib/questions/difficulty-copy'

function firstNameOf(displayName: string): string {
  const trimmed = displayName.trim()
  if (!trimmed) return 'They'
  const [first] = trimmed.split(/\s+/)
  return first ?? trimmed
}

export type AuthoredQuestionDifficulty = 'accessible' | 'moderate' | 'specialist'

export type AuthoredQuestionItem = {
  id: string
  questionText: string
  category: string | null
  broadCategory: string | null
  difficulty: AuthoredQuestionDifficulty | null
  createdAt: string
  viewerAnswered: { result: 'correct' | 'incorrect' } | null
}

// Ordered so the difficulty dropdown reads easiest → hardest regardless of
// the order questions happen to arrive in.
const DIFFICULTY_ORDER: AuthoredQuestionDifficulty[] = [
  'accessible',
  'moderate',
  'specialist',
]

type AnswerResult = {
  isCorrect: boolean
  correctAnswer: string
  explanation: string | null
  awardedPoints: number | null
  creatorNote: string | null
  submittedAnswer: string
}

// A question counts as answered by the viewer if they answered it in this
// session (local `results`) or had a persisted answer when the page loaded.
function isAnsweredByViewer(
  item: AuthoredQuestionItem,
  results: Record<string, AnswerResult>,
) {
  return Boolean(results[item.id]) || item.viewerAnswered !== null
}

type AuthoredQuestionsFeedProps = {
  questions: AuthoredQuestionItem[]
  friendDisplayName: string
  // Accepted for call-site compatibility; the list rows no longer render
  // per-card attribution, so the author's id/href aren't needed here.
  friendUserId?: string
  friendProfileHref?: string
  // Preview mode for the profile dashboard. When set, the feed renders a
  // capped, filter-free list (answer-in-place still works) plus a "View all"
  // link to the full questions page at this href. The full filterable list is
  // the default mode (no viewAllHref).
  viewAllHref?: string
  // Max rows in preview mode. Defaults to 5.
  previewLimit?: number
}

// A single question rendered as a list row, matching the Questions page
// (MyQuestionCard): a System-voice category eyebrow, a difficulty pill, and the
// serif question. The profile is the author's, so questions are NOT framed as
// "sent directly to you" — the viewer simply answers them in place via the
// "Answer →" link (in the slot the Questions page uses for its author metrics).
// Once answered, the link is replaced by a quiet result line.
function ProfileQuestionRow({
  item,
  answered,
  result,
  onAnswer,
}: {
  item: AuthoredQuestionItem
  answered: boolean
  result: AnswerResult | undefined
  onAnswer: () => void
}) {
  const visibleCategory = visibleFeedCategory(item.category)
  const difficultyLabel = item.difficulty
    ? difficultyCopyFromEstimate(item.difficulty)
    : null
  const isCorrect = result
    ? result.isCorrect
    : item.viewerAnswered?.result === 'correct'

  return (
    <article className="border-t border-[var(--brand-rule)] py-4 first:border-t-0">
      {visibleCategory || difficultyLabel ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {visibleCategory ? (
            <span
              className="truncate type-eyebrow leading-tight uppercase tracking-eyebrow"
              style={{
                // Category label is metadata — System voice (mono), per
                // STYLE-GUIDE-TYPE §2/§5, matching MyQuestionCard.
                fontFamily: 'var(--font-mono)',
                color: 'var(--ink)',
                opacity: 0.7,
              }}
            >
              {visibleCategory}
            </span>
          ) : null}
          {difficultyLabel ? (
            <span
              className="rounded-full bg-[rgba(0,0,0,0.06)] px-2 py-0.5 type-eyebrow font-medium uppercase tracking-wide"
              style={{ color: 'var(--ink)', opacity: 0.7 }}
              aria-label={`Difficulty: ${difficultyLabel}`}
            >
              {difficultyLabel}
            </span>
          ) : null}
        </div>
      ) : null}

      <p className="mt-2 font-serif type-card-title font-semibold leading-[28px] tracking-normal text-[var(--brand-ink)]">
        {item.questionText}
      </p>

      {answered ? (
        <div className="mt-2">
          <p
            className="text-quiet font-medium"
            style={{ color: 'var(--ink)', opacity: 0.7 }}
          >
            {isCorrect ? 'You answered ✓' : 'Reviewed privately'}
          </p>
          {result && !result.isCorrect && result.correctAnswer ? (
            <p
              className="mt-1 text-quiet"
              style={{ color: 'var(--ink)', opacity: 0.65 }}
            >
              Answer: {result.correctAnswer}
            </p>
          ) : null}
          {result?.explanation ? (
            <p
              className="mt-1 text-quiet italic leading-snug"
              style={{ color: 'var(--ink)', opacity: 0.65 }}
            >
              {result.explanation}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-1 flex justify-end">
          <FeedActionLink onClick={onAnswer}>Answer →</FeedActionLink>
        </div>
      )}
    </article>
  )
}

export function AuthoredQuestionsFeed({
  questions,
  friendDisplayName,
  viewAllHref,
  previewLimit = 5,
}: AuthoredQuestionsFeedProps) {
  const isPreview = Boolean(viewAllHref)
  const [results, setResults] = useState<Record<string, AnswerResult>>({})
  const [answerSheetId, setAnswerSheetId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedDifficulty, setSelectedDifficulty] = useState('')
  const [selectedAnswered, setSelectedAnswered] = useState<
    '' | 'answered' | 'unanswered'
  >('')

  const categoryOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const question of questions) {
      if (question.broadCategory) seen.add(question.broadCategory)
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b))
  }, [questions])

  const difficultyOptions = useMemo(() => {
    const present = new Set<AuthoredQuestionDifficulty>()
    for (const question of questions) {
      if (question.difficulty) present.add(question.difficulty)
    }
    return DIFFICULTY_ORDER.filter((value) => present.has(value)).map((value) => ({
      value,
      label: difficultyCopyFromEstimate(value) ?? value,
    }))
  }, [questions])

  // Only surface the answered/unanswered filter when the viewer actually has
  // a mix to sort through, mirroring how the category/difficulty selects only
  // appear when there's more than one option.
  const showAnsweredFilter = useMemo(() => {
    let hasAnswered = false
    let hasUnanswered = false
    for (const question of questions) {
      if (isAnsweredByViewer(question, results)) hasAnswered = true
      else hasUnanswered = true
      if (hasAnswered && hasUnanswered) return true
    }
    return false
  }, [questions, results])

  const visibleQuestions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return questions.filter((question) => {
      if (query && !question.questionText.toLowerCase().includes(query)) {
        return false
      }
      if (selectedCategory && question.broadCategory !== selectedCategory) {
        return false
      }
      if (selectedDifficulty && question.difficulty !== selectedDifficulty) {
        return false
      }
      if (selectedAnswered) {
        const answered = isAnsweredByViewer(question, results)
        if (selectedAnswered === 'answered' && !answered) return false
        if (selectedAnswered === 'unanswered' && answered) return false
      }
      return true
    })
  }, [
    questions,
    searchQuery,
    selectedCategory,
    selectedDifficulty,
    selectedAnswered,
    results,
  ])

  const submitAnswer = useCallback(
    async (item: AuthoredQuestionItem, submittedAnswer: string) => {
      setBusyId(item.id)
      setError(null)
      try {
        const response = await fetch(`/api/questions/${item.id}/answer`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ submitted_answer: submittedAnswer }),
        })
        const body = (await response.json().catch(() => null)) as
          | {
              isCorrect?: boolean
              correctAnswer?: string
              explanation?: string | null
              pointsAwarded?: number | null
              creatorNote?: string | null
              message?: string
            }
          | null
        if (!response.ok || !body || typeof body.isCorrect !== 'boolean') {
          throw new Error(body?.message ?? 'Could not submit that answer.')
        }
        const result: AnswerResult = {
          isCorrect: body.isCorrect,
          correctAnswer: body.correctAnswer ?? '',
          explanation: body.explanation ?? null,
          awardedPoints: body.pointsAwarded ?? null,
          creatorNote: body.creatorNote ?? null,
          submittedAnswer,
        }
        setResults((current) => ({ ...current, [item.id]: result }))
        setAnswerSheetId(null)
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Could not submit that answer.',
        )
      } finally {
        setBusyId(null)
      }
    },
    [],
  )

  const sheetItem = answerSheetId
    ? questions.find((q) => q.id === answerSheetId) ?? null
    : null

  const friendFirstName = firstNameOf(friendDisplayName)

  // Dashboard preview: a capped, filter-free list with a link to the full
  // questions page. Answering still works in place via the AnswerSheet.
  if (isPreview && viewAllHref) {
    const previewQuestions = questions.slice(0, previewLimit)
    const hasMore = questions.length > previewQuestions.length

    return (
      <section
        className="mt-8 border-t border-[var(--brand-rule)] pt-8"
        aria-label="Questions"
      >
        <h2 className="font-serif text-2xl font-semibold">Questions</h2>

        {error ? (
          <p className="mt-3 rounded-md border border-[var(--destructive-border)] bg-[var(--destructive-surface)] px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {previewQuestions.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">
            {friendFirstName} hasn&rsquo;t written any questions yet.
          </p>
        ) : (
          <div className="mt-1">
            {previewQuestions.map((item) => {
              const localResult = results[item.id]
              const isAnswered =
                Boolean(localResult) || item.viewerAnswered !== null
              return (
                <ProfileQuestionRow
                  key={item.id}
                  item={item}
                  answered={isAnswered}
                  result={localResult}
                  onAnswer={() => setAnswerSheetId(item.id)}
                />
              )
            })}
          </div>
        )}

        {hasMore ? (
          <Link
            href={viewAllHref}
            className="mt-3 inline-flex text-sm font-semibold text-[var(--warm-ink)] underline-offset-4 hover:underline"
          >
            View all {friendFirstName}&rsquo;s questions &rarr;
          </Link>
        ) : null}

        {sheetItem ? (
          <AnswerSheet
            question={sheetItem.questionText}
            category={sheetItem.category}
            onSubmit={(answer) => void submitAnswer(sheetItem, answer)}
            onClose={() => setAnswerSheetId(null)}
            loading={busyId === sheetItem.id}
          />
        ) : null}
      </section>
    )
  }

  return (
    <section
      className="mt-5"
      aria-label={`Questions ${friendDisplayName} wrote`}
    >
      <div className="mb-4">
        <h2 className="font-serif text-xl font-semibold">
          Questions {friendDisplayName} wrote
        </h2>
      </div>

      {error ? (
        <p className="mb-3 rounded-md border border-[var(--destructive-border)] bg-[var(--destructive-surface)] px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {questions.length === 0 ? (
        <p className="text-muted-foreground bg-muted rounded-xl px-3 py-2 text-sm">
          {friendDisplayName} hasn&rsquo;t written any questions yet.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="relative block">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <input
                className="bg-[var(--brand-field)] focus:border-[var(--brand-navy)] h-11 w-full rounded-md border border-[var(--accent-gold)] pr-3 pl-10 text-sm outline-none"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search questions..."
                aria-label="Search questions"
              />
            </label>
            {categoryOptions.length > 1 ||
            difficultyOptions.length > 1 ||
            showAnsweredFilter ? (
              <div className="flex flex-wrap gap-2">
                {showAnsweredFilter ? (
                  <select
                    className="bg-background text-foreground h-10 flex-1 rounded-md border px-3 text-sm"
                    value={selectedAnswered}
                    onChange={(event) =>
                      setSelectedAnswered(
                        event.target.value as '' | 'answered' | 'unanswered',
                      )
                    }
                    aria-label="Filter by answered status"
                  >
                    <option value="">All questions</option>
                    <option value="answered">Answered by you</option>
                    <option value="unanswered">Unanswered</option>
                  </select>
                ) : null}
                {categoryOptions.length > 1 ? (
                  <select
                    className="bg-background text-foreground h-10 flex-1 rounded-md border px-3 text-sm"
                    value={selectedCategory}
                    onChange={(event) => setSelectedCategory(event.target.value)}
                    aria-label="Filter by category"
                  >
                    <option value="">All categories</option>
                    {categoryOptions.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                ) : null}
                {difficultyOptions.length > 1 ? (
                  <select
                    className="bg-background text-foreground h-10 flex-1 rounded-md border px-3 text-sm"
                    value={selectedDifficulty}
                    onChange={(event) => setSelectedDifficulty(event.target.value)}
                    aria-label="Filter by difficulty"
                  >
                    <option value="">All difficulties</option>
                    {difficultyOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            ) : null}
          </div>

          {visibleQuestions.length === 0 ? (
            <p className="text-muted-foreground bg-muted rounded-xl px-3 py-2 text-sm">
              No questions match your filters.
            </p>
          ) : null}

          {visibleQuestions.length > 0 ? (
            <div>
              {visibleQuestions.map((item) => {
                const localResult = results[item.id]
                const isAnswered =
                  Boolean(localResult) || item.viewerAnswered !== null

                return (
                  <ProfileQuestionRow
                    key={item.id}
                    item={item}
                    answered={isAnswered}
                    result={localResult}
                    onAnswer={() => setAnswerSheetId(item.id)}
                  />
                )
              })}
            </div>
          ) : null}
        </div>
      )}

      {sheetItem ? (
        <AnswerSheet
          question={sheetItem.questionText}
          category={sheetItem.category}
          onSubmit={(answer) => void submitAnswer(sheetItem, answer)}
          onClose={() => setAnswerSheetId(null)}
          loading={busyId === sheetItem.id}
        />
      ) : null}
    </section>
  )
}
