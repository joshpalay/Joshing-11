'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Check, Sparkles, X } from 'lucide-react'

import { NewTerritoryUndo } from './NewTerritoryUndo'
import { visibleFeedCategory } from './category'

// Darkened triangle-gold for text/eyebrows that need to clear AA on the cream
// card (raw --tri-amber #d9a82e is too light for small text). Used by the
// "New territory" celebration and the "Between us friends" inside-joke card.
const GOLD_INK = 'color-mix(in srgb, var(--tri-amber) 50%, var(--brand-ink))'

type AnswerFeedbackSheetProps = {
  question: string
  category?: string | null
  isCorrect: boolean
  pointsAwarded: number | null
  correctAnswer: string
  submittedAnswer: string
  explanation: string | null
  creatorNote: string | null
  insideJoke?: string | null
  openedNewTerritory?: boolean
  openedTerritoryDomain?: string | null
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
  creatorNote,
  insideJoke = null,
  openedNewTerritory = false,
  openedTerritoryDomain = null,
  questionId,
  feedItemId,
  onClose,
}: AnswerFeedbackSheetProps) {
  const visibleCategory = visibleFeedCategory(category)
  const showNewTerritory = openedNewTerritory && isCorrect
  const showTerritoryUndo = Boolean(openedTerritoryDomain) && isCorrect
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
    <div className="fixed inset-0 z-[55] flex items-end justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="Dismiss"
      />
      <div
        className={
          showNewTerritory
            ? 'relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-[var(--brand-card)] shadow-2xl ring-2'
            : 'relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-3xl bg-[var(--brand-card)] shadow-2xl'
        }
        style={showNewTerritory ? { '--tw-ring-color': 'color-mix(in srgb, var(--tri-amber) 55%, transparent)' } as CSSProperties : undefined}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          {showNewTerritory ? (
            <p
              className="inline-flex items-center gap-1.5 text-[0.68rem] font-semibold tracking-[0.18em] uppercase"
              style={{ color: GOLD_INK }}
            >
              <Sparkles className="size-3.5" aria-hidden />
              <span>
                New territory{visibleCategory ? <span style={{ opacity: 0.7 }}> · {visibleCategory.toUpperCase()}</span> : null}
              </span>
            </p>
          ) : visibleCategory ? (
            <p className="text-[0.68rem] font-semibold tracking-[0.18em] uppercase text-[var(--brand-ink-400)]">
              {visibleCategory.toUpperCase()}
            </p>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-11 items-center justify-center rounded-full text-[var(--brand-ink-400)] transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-2">
          <div className="flex items-center gap-3 pb-3">
            <span
              className="inline-flex size-9 items-center justify-center rounded-full"
              style={{
                backgroundColor: isCorrect
                  ? 'color-mix(in srgb, var(--game-correct) 15%, var(--brand-card))'
                  : 'color-mix(in srgb, var(--game-wrong-strong) 12%, var(--brand-card))',
                color: isCorrect ? 'var(--game-correct)' : 'var(--game-wrong-strong)',
              }}
              aria-hidden
            >
              {isCorrect ? <Check className="size-5" /> : <X className="size-5" />}
            </span>
            <p
              className="text-lg font-semibold"
              style={{ color: isCorrect ? 'var(--game-correct)' : 'var(--game-wrong-strong)' }}
            >
              {isCorrect ? 'Correct!' : 'Not quite'}
            </p>
            {isCorrect && points > 0 ? (
              <span
                className="ml-auto inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold text-white"
                style={{ backgroundColor: 'var(--game-correct)' }}
              >
                +{points} {points === 1 ? 'pt' : 'pts'}
              </span>
            ) : null}
          </div>

          {showTerritoryUndo && openedTerritoryDomain ? (
            <NewTerritoryUndo
              domain={openedTerritoryDomain}
              category={visibleCategory}
            />
          ) : null}

          <p className="pb-3 font-serif text-lg leading-7 text-[var(--brand-ink)]">
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
          </div>

          {explanation ? (
            <div className="rounded-2xl bg-muted p-4">
              <p className="font-serif text-[15px] leading-7 text-[var(--brand-ink-700)]">
                {explanation}
              </p>
            </div>
          ) : null}

          {insideJoke ? (
            <div
              className="mt-3 rounded-2xl border p-4"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--tri-amber) 12%, var(--brand-card))',
                borderColor: 'color-mix(in srgb, var(--tri-amber) 40%, var(--brand-border))',
              }}
            >
              <p
                className="text-[0.62rem] font-semibold tracking-[0.18em] uppercase"
                style={{ color: GOLD_INK }}
              >
                Between us friends
              </p>
              <p className="mt-1.5 font-serif text-[15px] leading-7 text-[var(--brand-ink)]">
                {insideJoke}
              </p>
            </div>
          ) : null}

          {creatorNote ? (
            <div className="mt-3 rounded-2xl border bg-muted p-4">
              <p className="text-[0.62rem] font-semibold tracking-[0.18em] uppercase text-muted-foreground">
                Why they asked
              </p>
              <p className="mt-1.5 font-serif text-[15px] leading-7 text-[var(--brand-ink)]">
                {creatorNote}
              </p>
            </div>
          ) : null}

          {!isCorrect ? (
            <div className="pt-3 text-[12px] text-muted-foreground">
              {bankState === 'saving' ? (
                <span>Saving to your practice bank…</span>
              ) : null}
              {bankState === 'saved' ? (
                <span>
                  Saved to your practice bank ·{' '}
                  <button
                    type="button"
                    onClick={() => void handleUndo()}
                    className="font-semibold text-foreground underline underline-offset-2 hover:opacity-70"
                  >
                    Undo
                  </button>
                </span>
              ) : null}
              {bankState === 'undoing' ? <span>Undoing…</span> : null}
              {bankState === 'undone' ? (
                <span className="text-muted-foreground">Removed from your practice bank.</span>
              ) : null}
              {bankState === 'error' ? (
                <span style={{ color: 'var(--game-wrong-strong)' }}>Could not update your practice bank.</span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="px-5 pt-2 pb-8">
          <button type="button" onClick={onClose} className="btn-primary w-full">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
