'use client'

import Link from 'next/link'
import { CheckCircle2, Clock, MessageCircleQuestion, Settings } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

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

function formatCountdown(targetIso: string, nowMs: number): string {
  const targetMs = Date.parse(targetIso)
  if (!Number.isFinite(targetMs)) return 'any second now'

  const remainingMs = targetMs - nowMs
  if (remainingMs < 60_000) return 'any second now'

  const totalMinutes = Math.ceil(remainingMs / 60_000)
  if (totalMinutes > 60) {
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    return `${hours}h ${minutes}m`
  }

  return `${totalMinutes}m`
}

export default function TodaysFiveCard({
  initialStatus = null,
  initialPreferences = null,
}: TodaysFiveCardProps = {}) {
  const [status, setStatus] = useState<DailyStatus | null>(initialStatus)
  const [preferences, setPreferences] = useState<DailyPreferences | null>(initialPreferences)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
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

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000)
    return () => window.clearInterval(timer)
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
    ? 'See your recap'
    : hasStartedRound
      ? 'Resume round'
      : 'Play now'
  const subtext = useMemo(() => {
    if (isComplete) {
      return `Done for today. Next round in ${formatCountdown(effectiveStatus.nextRoundAt, nowMs)}.`
    }
    return answered > 0 ? `${answered} of 5 answered` : 'Ready when you are'
  }, [answered, effectiveStatus.nextRoundAt, isComplete, nowMs])

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
    <div className="bg-card text-card-foreground w-full rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <span className="bg-muted text-foreground grid size-10 shrink-0 place-items-center rounded-md">
          {isComplete ? (
            <CheckCircle2 className="size-5" aria-hidden="true" />
          ) : (
            <MessageCircleQuestion className="size-5" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs font-medium tracking-[0.12em] uppercase">
              Today&apos;s Five
            </p>
            <Link
              href="/daily/setup"
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Set up daily round"
            >
              <Settings className="size-4" aria-hidden="true" />
            </Link>
          </div>
          <p className="text-foreground mt-2 text-sm leading-6">
            Five questions to keep your knowledge map moving.
          </p>
          {preferences ? (
            <p className="text-muted-foreground mt-0.5 text-xs leading-5">
              {preferenceSummary(preferences)}
            </p>
          ) : null}
          <p className="text-muted-foreground mt-1 text-sm leading-6">
            {subtext}
          </p>
          <div
            className="mt-3 flex items-center gap-1.5"
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
                      ? 'color-mix(in srgb, var(--foreground) 35%, transparent)'
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
                    width: isFilled ? 9 : 8,
                    height: isFilled ? 9 : 8,
                    background,
                    border: isFilled
                      ? 'none'
                      : '1px solid color-mix(in srgb, var(--foreground) 35%, transparent)',
                    opacity: isFilled ? 0.95 : 0.7,
                  }}
                />
              )
            })}
          </div>
        </div>
      </div>

      {isComplete ? (
        <>
          <Link
            href={playHref}
            className="btn-ghost mt-4 min-h-11 w-full justify-center gap-2"
          >
            <Clock className="size-4" aria-hidden="true" />
            {actionLabel}
          </Link>
          <button
            type="button"
            onClick={() => {
              void resetForToday()
            }}
            disabled={resetting}
            className="text-muted-foreground mt-2 w-full text-center text-xs font-medium tracking-[0.08em] uppercase underline underline-offset-4 disabled:opacity-60"
          >
            {resetting ? 'Resetting…' : 'Reset game for today and play again'}
          </button>
          {resetError ? (
            <p className="text-destructive mt-2 text-xs">{resetError}</p>
          ) : null}
        </>
      ) : (
        <Link
          href={playHref}
          className="btn-primary mt-4 min-h-11 w-full justify-center gap-2"
        >
          <MessageCircleQuestion className="size-4" aria-hidden="true" />
          {actionLabel}
        </Link>
      )}
    </div>
  )
}
