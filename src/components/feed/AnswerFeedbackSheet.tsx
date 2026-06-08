'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Check, MoreHorizontal, Sparkles, X } from 'lucide-react'

import { FeedActionLink } from './FeedActionLink'
import { NewTerritoryUndo } from './NewTerritoryUndo'
import { visibleFeedCategory } from './category'
import { INSIDE_JOKE_LABELS, type InsideJokeKind } from '@/lib/questions-types'
import { ReportReasonSheet, type ReportReasonTarget } from '@/components/report/ReportReasonSheet'

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
  insideJokeKind?: InsideJokeKind | null
  openedNewTerritory?: boolean
  openedTerritoryDomain?: string | null
  questionId: string
  feedItemId: string
  // Requests a second look at a wrong answer (typos, accepted synonyms, a
  // disputed canonical answer). Resolves with the verdict to surface inline.
  // Omit (or pass null) to hide the recheck affordance.
  onRecheck?: (() => Promise<{ accepted: boolean; message: string }>) | null
  // B-Report-2: opt-in content-reporting ⋯ menu. This sheet is shared across several
  // post-result surfaces; only the milestone inline flow enables it (the prompt scopes
  // the entry point to that surface). Omit on the feed/direct-answer result modals.
  report?: { target: ReportReasonTarget; surface: 'round_recap' | 'lately_result' } | null
  onClose: () => void
}

type BankState = 'idle' | 'saving' | 'saved' | 'undoing' | 'undone' | 'error'
type RecheckState = 'idle' | 'submitting' | 'done' | 'error'

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
  insideJokeKind = null,
  openedNewTerritory = false,
  openedTerritoryDomain = null,
  questionId,
  feedItemId,
  onRecheck = null,
  report = null,
  onClose,
}: AnswerFeedbackSheetProps) {
  const visibleCategory = visibleFeedCategory(category)
  const showNewTerritory = openedNewTerritory && isCorrect
  const showTerritoryUndo = Boolean(openedTerritoryDomain) && isCorrect
  const [bankState, setBankState] = useState<BankState>('idle')
  const hasAutoSavedRef = useRef(false)
  const [recheckState, setRecheckState] = useState<RecheckState>('idle')
  const [recheckMessage, setRecheckMessage] = useState<string | null>(null)
  const [recheckAccepted, setRecheckAccepted] = useState(false)
  // B-Report-2: the ⋯ menu (none existed on this surface before) and the "why" sheet.
  // A Lately milestone question is always a curated Question, so the target is questionId.
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [reportCategory, setReportCategory] = useState<'incorrect' | 'inappropriate' | null>(null)

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

  const requestRecheck = async () => {
    if (!onRecheck || recheckState === 'submitting') return
    setRecheckState('submitting')
    setRecheckMessage(null)
    setRecheckAccepted(false)
    try {
      const outcome = await onRecheck()
      setRecheckState('done')
      setRecheckMessage(outcome.message)
      setRecheckAccepted(outcome.accepted)
    } catch {
      setRecheckState('error')
      setRecheckMessage('Could not recheck that answer.')
      setRecheckAccepted(false)
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
            ? 'relative flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-[var(--brand-card)] shadow-2xl ring-2'
            : 'relative flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-3xl bg-[var(--brand-card)] shadow-2xl'
        }
        style={showNewTerritory ? { '--tw-ring-color': 'color-mix(in srgb, var(--tri-amber) 55%, transparent)' } as CSSProperties : undefined}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-1">
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
          <div className="flex items-center gap-1">
            {report ? (
              <button
                type="button"
                onClick={() => setIsMenuOpen(true)}
                aria-label="More actions"
                aria-expanded={isMenuOpen}
                className="inline-flex size-11 items-center justify-center rounded-full text-[var(--brand-ink-400)] transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <MoreHorizontal className="size-5" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex size-11 items-center justify-center rounded-full text-[var(--brand-ink-400)] transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-2">
          <div className="flex items-center gap-3 pb-2">
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

          <p className="pb-2 font-serif text-lg leading-6 text-[var(--brand-ink)]">
            {question}
          </p>

          <div className="space-y-1 pb-2">
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
            <div className="rounded-2xl bg-muted p-3.5">
              <p className="font-serif text-[15px] leading-6 text-[var(--brand-ink-700)]">
                {explanation}
              </p>
            </div>
          ) : null}

          {insideJoke ? (
            <div
              className="mt-2.5 rounded-2xl border p-3.5"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--tri-amber) 12%, var(--brand-card))',
                borderColor: 'color-mix(in srgb, var(--tri-amber) 40%, var(--brand-border))',
              }}
            >
              <p
                className="text-[0.62rem] font-semibold tracking-[0.18em] uppercase"
                style={{ color: GOLD_INK }}
              >
                {INSIDE_JOKE_LABELS[insideJokeKind ?? 'relational']}
              </p>
              <p className="mt-1 font-serif text-[15px] leading-6 text-[var(--brand-ink)]">
                {insideJoke}
              </p>
            </div>
          ) : null}

          {creatorNote ? (
            <div className="mt-2.5 rounded-2xl border bg-muted p-3.5">
              <p className="text-[0.62rem] font-semibold tracking-[0.18em] uppercase text-muted-foreground">
                Why they asked
              </p>
              <p className="mt-1 font-serif text-[15px] leading-6 text-[var(--brand-ink)]">
                {creatorNote}
              </p>
            </div>
          ) : null}

          {onRecheck ? (
            <div className="space-y-2 pt-3">
              {!isCorrect && recheckState !== 'done' ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Think we got this wrong?
                  </p>
                  <FeedActionLink
                    onClick={() => void requestRecheck()}
                    disabled={recheckState === 'submitting'}
                  >
                    {recheckState === 'submitting' ? 'Rechecking…' : 'Recheck →'}
                  </FeedActionLink>
                </div>
              ) : null}
              {recheckMessage ? (
                recheckAccepted ? (
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] font-medium"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--game-correct) 12%, var(--cream))',
                      borderColor: 'color-mix(in srgb, var(--game-correct) 35%, var(--border-warm))',
                      color: 'var(--game-correct)',
                    }}
                  >
                    <span aria-hidden className="text-[15px] leading-none">✓</span>
                    <span>{recheckMessage}</span>
                  </div>
                ) : (
                  <p
                    role="status"
                    aria-live="polite"
                    className="text-[11px]"
                    style={{
                      color: recheckState === 'error' ? 'var(--game-wrong-strong)' : 'var(--ink)',
                      opacity: recheckState === 'error' ? 1 : 0.6,
                    }}
                  >
                    {recheckMessage}
                  </p>
                )
              ) : null}
            </div>
          ) : null}

          {!isCorrect ? (
            <div className="pt-3 text-xs text-muted-foreground">
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

        <div className="px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={onClose} className="btn-primary w-full">
            Done
          </button>
        </div>
      </div>

      {report && isMenuOpen ? (
        <div
          className="fixed inset-0 z-[58] flex items-end justify-center px-3 pt-16 pb-3 sm:items-start sm:pt-24"
          style={{ background: 'rgba(0,0,0,0.2)' }}
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close menu"
            onClick={() => setIsMenuOpen(false)}
          />
          <div className="bg-background relative w-full max-w-md rounded-3xl border p-2 shadow-2xl sm:w-72 sm:rounded-2xl">
            <div className="flex items-center justify-between px-3 py-2 sm:hidden">
              <p className="text-foreground text-sm font-medium">More actions</p>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setIsMenuOpen(false)}
                className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex size-11 items-center justify-center rounded-full"
              >
                <X className="size-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false)
                setReportCategory('incorrect')
              }}
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm transition"
            >
              This is incorrect
            </button>
            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false)
                setReportCategory('inappropriate')
              }}
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm transition"
            >
              This is inappropriate
            </button>
          </div>
        </div>
      ) : null}

      {report && reportCategory ? (
        <ReportReasonSheet
          category={reportCategory}
          target={report.target}
          surface={report.surface}
          onClose={() => setReportCategory(null)}
          onSubmitted={(category) => {
            // Inappropriate → the result card disappears from view (close the modal).
            // Durable self-hide / propagation suppression is B-Report-3.
            if (category === 'inappropriate') onClose()
          }}
        />
      ) : null}
    </div>
  )
}
