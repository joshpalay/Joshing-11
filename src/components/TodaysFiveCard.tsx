'use client'

import Link from 'next/link'
import { Settings } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { formatNextResetTimeLocal } from '@/lib/games/timezone'

// useSyncExternalStore inputs for the client-only reset-time label. Hoisted so
// the subscribe/snapshot functions are stable across renders.
const subscribeNoop = () => () => {}
const getResetTimeSnapshot = () => formatNextResetTimeLocal()
const getResetTimeServerSnapshot = (): string | null => null

export type SlotOutcome = 'correct' | 'incorrect' | 'skipped' | 'unanswered'

export type DailyStatus = {
  questionsRemaining: number
  questionsAnswered: number
  isComplete: boolean
  nextRoundAt: string
  queueId: string | null
  slotOutcomes: SlotOutcome[]
}

export type DailyPreferences = {
  difficulty: 'normal' | 'moderate' | 'challenging' | 'ridiculous' | 'adaptive'
  domainMode: 'random' | 'custom'
  selectedDomains: string[]
}

type TodaysFiveCardProps = {
  /** When supplied, the initial /api/daily/status fetch is skipped. */
  initialStatus?: DailyStatus | null
  /** When supplied, the initial /api/daily/preferences fetch is skipped. */
  initialPreferences?: DailyPreferences | null
  /**
   * Outstanding catch-up questions for this player. Drives the completed-state
   * branch: >0 routes to catch-up (Branch A); 0 nudges toward sending/banking a
   * question (Branch B). Per-card, not whole-home — the standalone Catch up card
   * is suppressed by the home page when this is >0 in the completed state.
   */
  initialMissedCount?: number
}

const DIFFICULTY_LABELS: Record<string, string> = {
  normal: 'Establishing',
  moderate: 'Familiar',
  challenging: 'Solid',
  ridiculous: 'Mastery',
  adaptive: 'Adaptive',
}

function preferenceSummary(prefs: DailyPreferences): string {
  const diffLabel = DIFFICULTY_LABELS[prefs.difficulty] ?? 'Adaptive'
  if (prefs.domainMode === 'random') return `${diffLabel} · Random`
  if (prefs.selectedDomains.length === 0) return `${diffLabel} · Custom`
  const domains = prefs.selectedDomains.slice(0, 3).join(', ')
  const extra = prefs.selectedDomains.length > 3 ? ` +${prefs.selectedDomains.length - 3}` : ''
  return `${diffLabel} · ${domains}${extra}`
}

const FALLBACK_STATUS: DailyStatus = {
  questionsRemaining: 5,
  questionsAnswered: 0,
  isComplete: false,
  nextRoundAt: new Date().toISOString(),
  queueId: null,
  slotOutcomes: ['unanswered', 'unanswered', 'unanswered', 'unanswered', 'unanswered'],
}

const VALID_OUTCOMES: ReadonlySet<SlotOutcome> = new Set<SlotOutcome>([
  'correct',
  'incorrect',
  'skipped',
  'unanswered',
])

function normalizeSlotOutcomes(value: unknown): SlotOutcome[] {
  const fallback: SlotOutcome[] = ['unanswered', 'unanswered', 'unanswered', 'unanswered', 'unanswered']
  if (!Array.isArray(value)) return fallback
  return fallback.map((unanswered, index) => {
    const candidate = value[index]
    return typeof candidate === 'string' && VALID_OUTCOMES.has(candidate as SlotOutcome)
      ? (candidate as SlotOutcome)
      : unanswered
  })
}

export default function TodaysFiveCard({
  initialStatus = null,
  initialPreferences = null,
  initialMissedCount = 0,
}: TodaysFiveCardProps = {}) {
  const [status, setStatus] = useState<DailyStatus | null>(initialStatus)
  const [preferences, setPreferences] = useState<DailyPreferences | null>(initialPreferences)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  // Client-only reset-time label; null during SSR to keep hydration stable.
  const resetTime = useSyncExternalStore(
    subscribeNoop,
    getResetTimeSnapshot,
    getResetTimeServerSnapshot,
  )
  // Skip the initial /api/daily/* fetch when the server already provided both.
  const skipInitialFetchRef = useRef(initialStatus !== null && initialPreferences !== null)

  useEffect(() => {
    if (skipInitialFetchRef.current) {
      skipInitialFetchRef.current = false
      return
    }
    let cancelled = false

    async function loadStatus() {
      try {
        const [statusResponse, prefsResponse] = await Promise.all([
          fetch('/api/daily/status', { cache: 'no-store', credentials: 'include' }),
          fetch('/api/daily/preferences', { cache: 'no-store', credentials: 'include' }),
        ])
        if (!statusResponse.ok) throw new Error('daily status unavailable')
        const body = await statusResponse.json()
        if (cancelled) return
        setStatus({
          questionsRemaining:
            typeof body.questionsRemaining === 'number'
              ? body.questionsRemaining
              : FALLBACK_STATUS.questionsRemaining,
          questionsAnswered:
            typeof body.questionsAnswered === 'number'
              ? body.questionsAnswered
              : typeof body.answered === 'number'
                ? body.answered
                : FALLBACK_STATUS.questionsAnswered,
          isComplete:
            typeof body.isComplete === 'boolean'
              ? body.isComplete
              : typeof body.complete === 'boolean'
                ? body.complete
                : FALLBACK_STATUS.isComplete,
          nextRoundAt:
            typeof body.nextRoundAt === 'string'
              ? body.nextRoundAt
              : FALLBACK_STATUS.nextRoundAt,
          queueId: typeof body.queue_id === 'string' ? body.queue_id : null,
          slotOutcomes: normalizeSlotOutcomes(body.slotOutcomes),
        })
        if (prefsResponse.ok) {
          const prefsBody = await prefsResponse.json()
          const prefs = prefsBody?.preferences
          if (prefs) {
            setPreferences({
              difficulty: prefs.difficulty ?? 'adaptive',
              domainMode: prefs.domainMode ?? 'random',
              selectedDomains: Array.isArray(prefs.selectedDomains) ? prefs.selectedDomains : [],
            })
          }
        }
      } catch {
        if (!cancelled) setStatus(FALLBACK_STATUS)
      }
    }

    void loadStatus()

    return () => {
      cancelled = true
    }
  }, [])

  const effectiveStatus = status ?? FALLBACK_STATUS
  const answered = Math.max(0, Math.min(effectiveStatus.questionsAnswered, 5))
  const isComplete =
    effectiveStatus.isComplete || effectiveStatus.questionsRemaining <= 0
  const hasStartedRound = Boolean(effectiveStatus.queueId) && answered > 0
  const playHref = isComplete
    ? '/daily/summary'
    : '/daily'
  const actionLabel = isComplete
    ? "See today's recap →"
    : hasStartedRound
      ? 'Resume round'
      : 'Play now'
  const missedCount = Math.max(0, initialMissedCount)
  // The session-end forward beat — rendered as its own quiet line in both
  // completed branches so it survives even an all-skipped (answered === 0) round.
  const forwardBeat = resetTime
    ? `Five new at ${resetTime} tomorrow`
    : 'Five new tomorrow'
  const subtext = isComplete
    ? 'Today done'
    : answered > 0
      ? `${answered} of 5 answered`
      : 'Ready when you are'
  // Editorial serif headline (display/Body-Serif), contextual to round state.
  const headline = isComplete
    ? 'Today, done.'
    : hasStartedRound
      ? 'Pick up where you left off'
      : 'Ready when you are!'

  const resetForToday = async () => {
    if (resetting) return
    setResetError(null)
    setResetting(true)
    try {
      const response = await fetch('/api/daily/reset', {
        method: 'POST',
        credentials: 'include',
      })
      const body = await response.json().catch(() => null)
      if (!response.ok)
        throw new Error(body?.message ?? 'Could not reset daily round.')
      window.location.assign('/daily')
    } catch (caught) {
      setResetError(
        caught instanceof Error
          ? caught.message
          : 'Could not reset daily round.'
      )
      setResetting(false)
    }
  }

  return (
    <div className="bg-card text-card-foreground w-full rounded-[4px] border border-[var(--brand-border)] px-4 py-5 shadow-[0_4px_12px_rgba(40,32,30,0.04)]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-bold tracking-[0.12em] text-[var(--brand-ink-700)] uppercase">
          Today&apos;s Five
        </p>
        <Link
          href="/daily/setup"
          className="text-[var(--brand-ink-400)] transition-colors hover:text-[var(--brand-ink)]"
          aria-label="Set up daily round"
        >
          <Settings className="size-4" aria-hidden="true" />
        </Link>
      </div>

      <h2 className="mt-3 mb-2 font-serif text-[32px] leading-[40px] font-medium tracking-[-0.1px] text-[var(--brand-ink)]">
        {headline}
      </h2>

      <div
        className="mt-3 flex items-center gap-2"
        aria-label={`${answered} of 5 answered`}
      >
        {Array.from({ length: 5 }, (_, index) => {
          const outcome = effectiveStatus.slotOutcomes[index] ?? 'unanswered'
          const isFilled = outcome !== 'unanswered'
          const background =
            outcome === 'correct'
              ? 'var(--success)'
              : outcome === 'incorrect'
                ? 'var(--destructive)'
                : outcome === 'skipped'
                  ? 'color-mix(in srgb, var(--brand-ink) 35%, transparent)'
                  : 'transparent'
          const label =
            outcome === 'correct'
              ? 'Correct'
              : outcome === 'incorrect'
                ? 'Wrong'
                : outcome === 'skipped'
                  ? 'Skipped'
                  : 'Not answered'
          return (
            <span
              key={index}
              className="block rounded-full"
              aria-label={label}
              title={label}
              style={{
                width: 11,
                height: 11,
                background,
                border: isFilled
                  ? 'none'
                  : '1px solid color-mix(in srgb, var(--brand-ink) 35%, transparent)',
                opacity: isFilled ? 0.95 : 0.7,
              }}
            />
          )
        })}
      </div>

      {answered > 0 || preferences ? (
        <p className="mt-2.5 text-xs leading-5 text-[var(--brand-ink-400)]">
          {answered > 0 ? subtext : null}
          {answered > 0 && preferences ? ' · ' : null}
          {preferences ? preferenceSummary(preferences) : null}
        </p>
      ) : null}

      {isComplete ? (
        <div className="mt-4 space-y-3">
          {missedCount > 0 ? (
            // Branch A — outstanding catch-up questions own the only button here;
            // the home page suppresses the standalone Catch up card to match.
            <Link
              href="/daily/catchup"
              className="btn-primary flex min-h-12 w-full items-center justify-center rounded-[4px] bg-[var(--brand-link)] text-base font-bold tracking-[0.04em] text-white"
            >
              {missedCount === 1
                ? 'Play your 1 missed →'
                : `Play your ${missedCount} missed →`}
            </Link>
          ) : (
            // Branch B — nothing left to catch up on; turn the player outward.
            // "Send a friend a question" routes to the existing recipient-first
            // authoring flow (CreateChooser's "send to specific people" intent).
            <>
              <Link
                href="/questions?create=1&intent=specific"
                className="btn-primary flex min-h-12 w-full items-center justify-center rounded-[4px] bg-[var(--brand-link)] text-base font-bold tracking-[0.04em] text-white"
              >
                Send a friend a question →
              </Link>
              <Link
                href="/questions?create=1&intent=bank"
                className="block text-center text-sm font-medium text-[var(--brand-ink-400)] underline underline-offset-4 transition-colors hover:text-[var(--brand-ink)]"
              >
                or add one to your bank
              </Link>
            </>
          )}

          {/* Recap is link-weight in both branches — never a button. */}
          <Link
            href="/daily/summary"
            className="block text-center text-sm font-semibold tracking-[0.02em] text-[var(--brand-link)] underline underline-offset-4"
          >
            See today&apos;s recap →
          </Link>

          {/* Session-end forward beat — unconditional in both branches. */}
          <p className="text-center text-xs leading-5 text-[var(--brand-ink-400)]">
            {forwardBeat}
          </p>

          {/* Quiet tertiary reset link in both branches. */}
          <button
            type="button"
            onClick={() => {
              void resetForToday()
            }}
            disabled={resetting}
            className="w-full text-center text-xs font-medium tracking-[0.08em] text-[var(--brand-ink-400)] uppercase underline underline-offset-4 disabled:opacity-60"
          >
            {resetting ? 'Resetting…' : 'Reset game for today and play again'}
          </button>
          {resetError ? (
            <p className="text-destructive text-xs">{resetError}</p>
          ) : null}
        </div>
      ) : (
        <Link
          href={playHref}
          className="btn-primary mt-4 min-h-12 w-full justify-center rounded-[4px] bg-[var(--brand-link)] text-base font-bold tracking-[0.04em] text-white"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  )
}
