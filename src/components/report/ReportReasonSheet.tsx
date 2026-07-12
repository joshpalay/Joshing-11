'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'

// B-Report-2: the shaped "why" step (PRD §6.1.2 / §6.1.3). Shared form only — each
// surface keeps its own ⋯ menu (no menu refactor in this prompt). The two problem-
// named entry points open this sheet with the matching `category`; it collects the
// shaped reason and POSTs a ContentReport. No mechanism words ("flag/report/thumbs")
// appear in any copy here.

export type ReportReasonTarget =
  | { questionId: string; generatedQuestionId?: undefined }
  | { generatedQuestionId: string; questionId?: undefined }

type ReportCategory = 'incorrect' | 'inappropriate'
type IncorrectKind = 'answer_key' | 'premise'
type Status = 'form' | 'submitting' | 'done' | 'rate_limited' | 'error'

export function ReportReasonSheet({
  category,
  target,
  surface,
  onClose,
  onSubmitted,
}: {
  category: ReportCategory
  target: ReportReasonTarget
  surface: 'round_recap' | 'lately_result' | 'answered_list' | 'feed' | 'recovered'
  onClose: () => void
  // Fires once on a successful submit (including an idempotent duplicate). For
  // 'inappropriate' the parent removes the card from view; for 'incorrect' the card
  // is left unchanged and this sheet shows the quiet acknowledgement itself.
  onSubmitted: (category: ReportCategory) => void
}) {
  const [incorrectKind, setIncorrectKind] = useState<IncorrectKind | null>(null)
  const [note, setNote] = useState('')
  const [suggestedAnswer, setSuggestedAnswer] = useState('')
  const [status, setStatus] = useState<Status>('form')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const noteTrimmed = note.trim()
  const canSubmit =
    status !== 'submitting' &&
    noteTrimmed.length > 0 &&
    (category === 'inappropriate' || incorrectKind !== null)

  async function submit() {
    if (!canSubmit) return
    setStatus('submitting')
    try {
      const payload: Record<string, unknown> = {
        category,
        note: noteTrimmed,
        surface,
        ...(target.questionId
          ? { questionId: target.questionId }
          : { generatedQuestionId: target.generatedQuestionId }),
      }
      if (category === 'incorrect') {
        payload.incorrectKind = incorrectKind
        if (suggestedAnswer.trim()) payload.suggestedAnswer = suggestedAnswer.trim()
      }
      const res = await fetch('/api/content-reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      if (res.status === 429) {
        setStatus('rate_limited')
        return
      }
      if (!res.ok) {
        setStatus('error')
        return
      }
      // Success (incl. idempotent re-submit of an already-open item).
      if (category === 'inappropriate') {
        // The card vanishing is the feedback (§6.1.3); hand removal to the parent.
        onSubmitted('inappropriate')
        onClose()
        return
      }
      setStatus('done')
      onSubmitted('incorrect')
    } catch {
      setStatus('error')
    }
  }

  const heading =
    category === 'incorrect' ? 'What looks off?' : 'What feels wrong here?'

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <button
        type="button"
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.4)' }}
        onClick={onClose}
        aria-label="Dismiss"
      />
      <div className="relative flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-3xl bg-[var(--brand-card)] shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-4 pb-1">
          <p className="text-[0.68rem] font-semibold tracking-[0.18em] uppercase text-[var(--brand-ink-400)]">
            {category === 'incorrect' ? 'A second look' : 'Between us'}
          </p>
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
          {status === 'done' ? (
            <div className="py-6">
              <p className="font-serif text-lg leading-6 text-[var(--brand-ink)]">
                Thanks — we&apos;ll take a look.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                It stays in your recap for now.
              </p>
            </div>
          ) : status === 'rate_limited' ? (
            <div className="py-6">
              <p className="font-serif text-lg leading-6 text-[var(--brand-ink)]">
                You&apos;ve sent us a lot today.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Take a break — you can pick this back up tomorrow.
              </p>
            </div>
          ) : (
            <>
              <p className="pb-3 font-serif text-lg leading-6 text-[var(--brand-ink)]">
                {heading}
              </p>

              {category === 'incorrect' ? (
                <div className="pb-3">
                  <div className="flex gap-2">
                    <SegmentButton
                      selected={incorrectKind === 'answer_key'}
                      onClick={() => setIncorrectKind('answer_key')}
                    >
                      The answer
                    </SegmentButton>
                    <SegmentButton
                      selected={incorrectKind === 'premise'}
                      onClick={() => setIncorrectKind('premise')}
                    >
                      The question
                    </SegmentButton>
                  </div>
                </div>
              ) : (
                <p className="pb-3 text-sm leading-6 text-[var(--brand-ink-700)]">
                  Tell us what makes this a problem and we&apos;ll review it.
                </p>
              )}

              <label className="block">
                <span className="text-[0.62rem] font-semibold tracking-[0.14em] uppercase text-muted-foreground">
                  In your words
                </span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder={
                    category === 'incorrect'
                      ? 'What did we get wrong?'
                      : 'What feels off about this?'
                  }
                  className="mt-1 w-full resize-none rounded-2xl border border-[var(--accent-gold)] bg-[var(--brand-field)] p-3 font-serif text-[15px] leading-6 text-[var(--brand-ink)] focus:border-[var(--brand-navy)] focus-visible:outline-none"
                />
              </label>

              {category === 'incorrect' ? (
                <label className="mt-3 block">
                  <span className="text-[0.62rem] font-semibold tracking-[0.14em] uppercase text-muted-foreground">
                    The answer should be (optional)
                  </span>
                  <input
                    value={suggestedAnswer}
                    onChange={(e) => setSuggestedAnswer(e.target.value)}
                    placeholder="If you know it"
                    className="mt-1 w-full rounded-2xl border border-[var(--accent-gold)] bg-[var(--brand-field)] p-3 font-serif text-[15px] leading-6 text-[var(--brand-ink)] focus:border-[var(--brand-navy)] focus-visible:outline-none"
                  />
                </label>
              ) : null}

              {status === 'error' ? (
                <p
                  role="status"
                  aria-live="polite"
                  className="mt-3 text-[13px]"
                  style={{ color: 'var(--game-wrong-strong)' } as CSSProperties}
                >
                  That didn&apos;t go through. Give it another go in a moment.
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {status === 'done' || status === 'rate_limited' ? (
            <button type="button" onClick={onClose} className="btn-primary w-full">
              Done
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit}
              className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === 'submitting' ? 'Sending…' : 'Send'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function SegmentButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'flex-1 rounded-2xl border px-3 py-2 text-sm font-medium transition',
        selected
          ? 'border-[var(--brand-ink)] bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
