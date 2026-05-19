'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Sparkles, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { visibleFeedCategory } from './category'

type AnswerFeedbackSheetProps = {
  question: string
  category?: string | null
  isCorrect: boolean
  pointsAwarded: number | null
  correctAnswer: string
  submittedAnswer: string
  explanation: string | null
  quip: string | null
  openedNewTerritory?: boolean
  questionId: string
  feedItemId: string
  onClose: () => void
}

type BankState = 'idle' | 'saving' | 'saved' | 'undoing' | 'undone' | 'error'

export function AnswerFeedbackSheet({
  question,
  category,
  isCorrect,
  pointsAwarded,
  correctAnswer,
  submittedAnswer,
  explanation,
  quip,
  openedNewTerritory = false,
  questionId,
  feedItemId,
  onClose,
}: AnswerFeedbackSheetProps) {
  const visibleCategory = visibleFeedCategory(category)
  const showNewTerritory = openedNewTerritory && isCorrect
  const [bankState, setBankState] = useState<BankState>('idle')
  const hasAutoSavedRef = useRef(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    if (isCorrect || hasAutoSavedRef.current) return
    hasAutoSavedRef.current = true
    setBankState('saving')
    void (async () => {
      try {
        const response = await fetch('/api/bank', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            questionId,
            contextType: 'feed',
            contextId: feedItemId,
          }),
        })
        if (!response.ok) throw new Error('save failed')
        setBankState('saved')
      } catch {
        setBankState('error')
      }
    })()
  }, [isCorrect, questionId, feedItemId])

  const handleUndo = async () => {
    if (bankState !== 'saved') return
    setBankState('undoing')
    try {
      const response = await fetch('/api/bank', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ questionId }),
      })
      if (!response.ok) throw new Error('undo failed')
      setBankState('undone')
    } catch {
      setBankState('error')
    }
  }

  const points = typeof pointsAwarded === 'number' ? pointsAwarded : 0

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="Dismiss"
      />
      <div
        className={
          showNewTerritory
            ? 'relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl ring-2 ring-amber-400/60'
            : 'relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-3xl bg-white shadow-2xl'
        }
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          {showNewTerritory ? (
            <p className="inline-flex items-center gap-1.5 text-[0.68rem] font-semibold tracking-[0.18em] uppercase text-amber-700">
              <Sparkles className="size-3.5" aria-hidden />
              <span>
                New territory{visibleCategory ? <span className="text-amber-700/70"> · {visibleCategory.toUpperCase()}</span> : null}
              </span>
            </p>
          ) : visibleCategory ? (
            <p className="text-[0.68rem] font-semibold tracking-[0.18em] uppercase text-stone-500">
              {visibleCategory.toUpperCase()}
            </p>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-8 items-center justify-center rounded-full text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-2">
          <div className="flex items-center gap-3 pb-3">
            <span
              className={
                isCorrect
                  ? 'inline-flex size-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700'
                  : 'inline-flex size-9 items-center justify-center rounded-full bg-stone-100 text-stone-700'
              }
              aria-hidden
            >
              {isCorrect ? <Check className="size-5" /> : <X className="size-5" />}
            </span>
            <p
              className={
                isCorrect
                  ? 'text-lg font-semibold text-emerald-700'
                  : 'text-lg font-semibold text-stone-800'
              }
            >
              {isCorrect ? 'Correct!' : 'Not quite'}
            </p>
            {isCorrect && points > 0 ? (
              <span className="ml-auto inline-flex items-center rounded-full bg-emerald-600 px-3 py-1 text-sm font-semibold text-white">
                +{points} {points === 1 ? 'pt' : 'pts'}
              </span>
            ) : null}
          </div>

          {showNewTerritory ? (
            <div className="mb-3 flex items-start gap-3 rounded-2xl border border-amber-300/70 bg-amber-50 px-4 py-3">
              <span
                className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700"
                aria-hidden
              >
                <Sparkles className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="font-serif text-[15px] leading-snug font-semibold text-amber-900">
                  You opened new territory
                  {visibleCategory ? <> in {visibleCategory}</> : null}.
                </p>
                <p className="mt-0.5 text-[12px] text-amber-800/80">
                  First time you&rsquo;ve gotten a question right here. It&rsquo;s on your map now.
                </p>
              </div>
            </div>
          ) : null}

          <p className="pb-3 font-serif text-lg leading-7 text-stone-950">
            {question}
          </p>

          <div className="space-y-1.5 pb-3">
            <p
              className="text-[13px] italic"
              style={{
                fontFamily: 'var(--font-literata)',
                color: 'var(--ink)',
                opacity: 0.7,
              }}
            >
              Your answer: {submittedAnswer}
            </p>
            {!isCorrect && correctAnswer ? (
              <p
                className="text-[13px] italic"
                style={{
                  fontFamily: 'var(--font-literata)',
                  color: 'var(--ink)',
                  opacity: 0.85,
                }}
              >
                Correct answer: {correctAnswer}
              </p>
            ) : null}
            {!isCorrect && quip ? (
              <p
                className="text-[13px]"
                style={{ color: 'var(--ink)', opacity: 0.6 }}
              >
                {quip}
              </p>
            ) : null}
          </div>

          {explanation ? (
            <div className="rounded-2xl bg-stone-50 p-4">
              <p className="font-serif text-[15px] leading-7 text-stone-800">
                {explanation}
              </p>
            </div>
          ) : null}

          {!isCorrect ? (
            <div className="pt-3 text-[12px] text-stone-600">
              {bankState === 'saving' ? (
                <span>Saving to your practice bank…</span>
              ) : null}
              {bankState === 'saved' ? (
                <span>
                  Saved to your practice bank ·{' '}
                  <button
                    type="button"
                    onClick={() => void handleUndo()}
                    className="font-semibold text-stone-800 underline underline-offset-2 hover:text-stone-950"
                  >
                    Undo
                  </button>
                </span>
              ) : null}
              {bankState === 'undoing' ? <span>Undoing…</span> : null}
              {bankState === 'undone' ? (
                <span className="text-stone-500">Removed from your practice bank.</span>
              ) : null}
              {bankState === 'error' ? (
                <span className="text-red-700">Could not update your practice bank.</span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="px-5 pt-2 pb-8">
          <Button
            type="button"
            onClick={onClose}
            className="w-full bg-stone-950 text-white hover:bg-stone-800"
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}
