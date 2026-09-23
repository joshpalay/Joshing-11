'use client'

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Check, Clock, X } from 'lucide-react'

import { ARGUE_YOUR_POINT_MAX_LENGTH } from '@/lib/recheck-copy'

// "Argue your point" (B-ARGUE-01). Replaces the old one-tap "Recheck →" link
// with a dedicated full-screen-feeling panel: the question and the player's
// own answer stay in view, an optional 300-character case can be typed, and
// the verdict (including the genuine third outcome — "a person will look",
// not a disguised no) renders in the same panel behind an OK button. A slide-
// up sheet rather than a real route so a mid-round trigger (Daily Five,
// catch-up) can close back to exactly where the player was, with no
// navigation round-trip to lose their place.
//
// Shared across every recheck surface (daily, catch-up, feed, Lately
// milestone) — each surface's own onSubmit wraps its existing recheck fetch
// call and returns a status the sheet uses to pick the right verdict tone.

export type ArguePointStatus = 'accepted' | 'rejected' | 'needs_human' | 'disputed' | string

export type ArguePointOutcome = {
  accepted: boolean
  status?: ArguePointStatus | null
  message: string
}

type Phase = 'form' | 'submitting' | 'result' | 'error'

export function ArguePointSheet({
  question,
  submittedAnswer,
  onSubmit,
  onClose,
}: {
  question: string
  submittedAnswer: string
  // Argument is null when the player submits without typing one — the field
  // is optional (an obvious typo doesn't need an essay to get a second look).
  onSubmit: (argument: string | null) => Promise<ArguePointOutcome>
  onClose: () => void
}) {
  const [argument, setArgument] = useState('')
  const [phase, setPhase] = useState<Phase>('form')
  const [outcome, setOutcome] = useState<ArguePointOutcome | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'submitting') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, phase])

  async function submit() {
    if (phase === 'submitting') return
    setPhase('submitting')
    setErrorMessage(null)
    try {
      const trimmed = argument.trim()
      const result = await onSubmit(trimmed.length > 0 ? trimmed : null)
      setOutcome(result)
      setPhase('result')
    } catch (caught) {
      setErrorMessage(caught instanceof Error ? caught.message : 'Could not submit that.')
      setPhase('error')
    }
  }

  const remaining = ARGUE_YOUR_POINT_MAX_LENGTH - argument.length

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center">
      <button
        type="button"
        className="absolute inset-0"
        style={{ background: 'var(--scrim)' }}
        onClick={() => phase !== 'submitting' && onClose()}
        aria-label="Dismiss"
      />
      <div className="relative flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-3xl bg-[var(--brand-card)] shadow-[var(--shadow-overlay)]">
        <div className="flex items-center justify-between px-5 pt-4 pb-1">
          <p className="text-xs font-semibold tracking-[0.18em] uppercase text-[var(--brand-ink-400)]">
            Argue your point
          </p>
          {phase !== 'submitting' ? (
            <button type="button" onClick={onClose} aria-label="Close" className="btn-icon rounded-full">
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-2">
          {phase === 'result' && outcome ? (
            <VerdictView outcome={outcome} />
          ) : (
            <>
              <p className="pb-1 font-serif text-lg leading-6 text-[var(--brand-ink)]">
                {question}
              </p>
              <p
                className="pb-3 text-quiet italic"
                style={{ fontFamily: 'var(--font-serif)', color: 'var(--ink)', opacity: 0.7 }}
              >
                Your answer: {submittedAnswer}
              </p>

              <label className="block">
                <span className="text-xs font-semibold tracking-[0.14em] uppercase text-muted-foreground">
                  Why do you think you&apos;re right? (optional)
                </span>
                <textarea
                  value={argument}
                  onChange={(e) => setArgument(e.target.value.slice(0, ARGUE_YOUR_POINT_MAX_LENGTH))}
                  rows={3}
                  maxLength={ARGUE_YOUR_POINT_MAX_LENGTH}
                  placeholder="Make your case…"
                  disabled={phase === 'submitting'}
                  className="mt-1 w-full resize-none rounded-2xl border border-[var(--accent-gold)] bg-[var(--brand-field)] p-3 font-serif text-base leading-6 text-[var(--brand-ink)] focus:border-[var(--brand-navy)] disabled:opacity-60"
                />
                <span
                  className="mt-1 block text-right text-xs"
                  style={{ color: 'var(--ink)', opacity: 0.5 }}
                >
                  {remaining} / {ARGUE_YOUR_POINT_MAX_LENGTH}
                </span>
              </label>

              {phase === 'error' && errorMessage ? (
                <p
                  role="status"
                  aria-live="polite"
                  className="mt-2 text-quiet"
                  style={{ color: 'var(--game-wrong-strong)' } as CSSProperties}
                >
                  {errorMessage}
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {phase === 'result' ? (
            <button type="button" onClick={onClose} className="btn-primary w-full">
              OK
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={phase === 'submitting'}
              className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === 'submitting' ? 'Reviewing your case…' : 'Submit'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function VerdictView({ outcome }: { outcome: ArguePointOutcome }) {
  // Three visual registers, not two: won / a-person-will-look / lost. Folding
  // needs_human or disputed into "lost" would tell a player they're wrong when
  // the honest answer is "undecided", which is both unkind and inaccurate.
  const pending = outcome.status === 'needs_human' || outcome.status === 'disputed'
  const tone = outcome.accepted ? 'accepted' : pending ? 'pending' : 'rejected'

  const palette: Record<string, { color: string; bg: string; icon: ReactNode; heading: string }> = {
    accepted: {
      color: 'var(--game-correct)',
      bg: 'color-mix(in srgb, var(--game-correct) 15%, var(--brand-card))',
      icon: <Check className="size-5" />,
      heading: "You're right!",
    },
    pending: {
      color: 'var(--accent-gold-ink)',
      bg: 'color-mix(in srgb, var(--accent-gold) 16%, var(--brand-card))',
      icon: <Clock className="size-5" />,
      heading: "We'll take a closer look",
    },
    rejected: {
      color: 'var(--game-wrong-strong)',
      bg: 'color-mix(in srgb, var(--game-wrong-strong) 12%, var(--brand-card))',
      icon: <X className="size-5" />,
      heading: 'Not quite',
    },
  }
  const p = palette[tone]

  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex items-center gap-3">
        <span
          className="inline-flex size-9 items-center justify-center rounded-full"
          style={{ backgroundColor: p.bg, color: p.color }}
          aria-hidden
        >
          {p.icon}
        </span>
        <p className="text-lg font-semibold" style={{ color: p.color }}>
          {p.heading}
        </p>
      </div>
      <p className="font-serif text-base leading-6 text-[var(--brand-ink-700)]">
        {outcome.message}
      </p>
    </div>
  )
}
