'use client'

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'

import {
  AnsweredByYouCard,
  AnswerSheet,
  DirectSentCard,
  type AnsweredByYouFeedItem,
  type DirectSentFeedItem,
} from '@/components/feed'
import { difficultyCopyFromEstimate } from '@/lib/questions/difficulty-copy'

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
  friendUserId: string
  friendProfileHref: string
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const now = new Date()
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(date)
}

function baseFields(
  item: AuthoredQuestionItem,
  answered: boolean,
  friendDisplayName: string,
  friendUserId: string,
) {
  const dateLabel = formatDate(item.createdAt)
  const metadata: ReactNode = (
    <span className="text-muted-foreground text-xs">
      {item.category ? <>{item.category}</> : null}
      {item.category && dateLabel ? <> · </> : null}
      {dateLabel ? <>{dateLabel}</> : null}
      {answered ? <> · You answered</> : null}
    </span>
  )

  return {
    id: item.id,
    metadata,
    category: item.category,
    question: item.questionText,
    personalMessage: null,
    isInBank: false,
    avatarName: friendDisplayName,
    avatarUserId: friendUserId,
  }
}

export function AuthoredQuestionsFeed({
  questions,
  friendDisplayName,
  friendUserId,
  friendProfileHref,
}: AuthoredQuestionsFeedProps) {
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

  return (
    <section
      className="mt-5"
      aria-label={`Questions ${friendDisplayName} wrote`}
    >
      <div className="mb-4">
        <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
          Questions
        </p>
        <h2 className="mt-1 font-serif text-xl font-semibold">
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
                className="bg-background focus:border-primary h-11 w-full rounded-md border pr-3 pl-10 text-sm outline-none"
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

          {visibleQuestions.map((item) => {
            const localResult = results[item.id]
            const persistedAnswered = item.viewerAnswered !== null
            const isAnswered = Boolean(localResult) || persistedAnswered

            if (isAnswered) {
              const isCorrect = localResult
                ? localResult.isCorrect
                : item.viewerAnswered?.result === 'correct'

              const answeredItem: AnsweredByYouFeedItem = {
                ...baseFields(item, true, friendDisplayName, friendUserId),
                avatarName: null,
                avatarUserId: null,
                type: 'answered_by_you',
                resultLabel: isCorrect ? 'You answered' : 'Reviewed privately',
                answerSummary: isCorrect
                  ? `You and ${friendDisplayName} have that in common.`
                  : 'You have already answered this question.',
                correctAnswer: localResult?.correctAnswer ?? null,
                submittedAnswer: localResult?.submittedAnswer ?? undefined,
                isCorrect,
                awardedPoints: localResult?.awardedPoints ?? null,
                explanation: localResult?.explanation ?? null,
                creatorNote: localResult?.creatorNote ?? null,
                unverifiedAnswer: false,
              }

              return <AnsweredByYouCard key={item.id} item={answeredItem} />
            }

            const directSent: DirectSentFeedItem = {
              ...baseFields(item, false, friendDisplayName, friendUserId),
              type: 'direct_sent',
              senderName: friendDisplayName,
              senderHref: friendProfileHref,
            }

            return (
              <DirectSentCard
                key={item.id}
                item={directSent}
                onAnswer={() => setAnswerSheetId(item.id)}
              />
            )
          })}
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
