'use client'

import Link from 'next/link'
import { SlidersHorizontal } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { formatNextResetDayTimeLocal } from '@/lib/games/timezone'

// useSyncExternalStore inputs for the client-only reset-time label. Hoisted so
// the subscribe/snapshot functions are stable across renders. The label is
// day-aware ("today at 1 PM" / "tomorrow at 1 PM"), so it stays correct when
// the next reset falls later on the current local day.
const subscribeNoop = () => () => {}
const getResetTimeSnapshot = () => formatNextResetDayTimeLocal()
const getResetTimeServerSnapshot = (): string | null => null

export type SlotOutcome = 'correct' | 'incorrect' | 'skipped' | 'unanswered'

export type DailyStatus = {
  questionsRemaining: number
  questionsAnswered: number
  isComplete: boolean
  nextRoundAt: string
  queueId: string | null
  slotOutcomes: SlotOutcome[]
  /**
   * Outcomes for the +2 bonus slots (D-4 §B), in order. 0–2 entries. Additive:
   * these render as the bonus dot-group after the core five, but never enter the
   * "of 5" count. Empty when there's no queue or no bonus slots.
   */
  bonusOutcomes: SlotOutcome[]
}

type TodaysFiveCardProps = {
  /** When supplied, the initial /api/daily/status fetch is skipped. */
  initialStatus?: DailyStatus | null
  /**
   * Outstanding catch-up questions for this player. Drives the completed-state
   * branch: >0 routes to catch-up (Branch A); 0 nudges toward sending/banking a
   * question (Branch B). Per-card, not whole-home — the standalone Catch up card
   * is suppressed by the home page when this is >0 in the completed state.
   */
  initialMissedCount?: number
}

const CUSTOMIZE_DAILY_LINK_CLASS = [
  'inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full',
  'border border-[color-mix(in_srgb,var(--brand-border)_60%,transparent)] bg-[var(--brand-cream-page)] px-3 py-2',
  'type-metadata font-semibold tracking-normal whitespace-nowrap text-[var(--brand-ink)]',
  'transition-[background-color,border-color,transform]',
  'hover:border-[color-mix(in_srgb,var(--brand-ink)_24%,var(--brand-border))] hover:bg-[var(--brand-card)]',
  'focus-visible:ring-2 focus-visible:ring-[var(--brand-ink)] focus-visible:ring-offset-2 focus-visible:outline-none',
  'active:translate-y-px sm:px-3.5 sm:text-quiet',
].join(' ')

const FALLBACK_STATUS: DailyStatus = {
  questionsRemaining: 5,
  questionsAnswered: 0,
  isComplete: false,
  nextRoundAt: new Date().toISOString(),
  queueId: null,
  slotOutcomes: ['unanswered', 'unanswered', 'unanswered', 'unanswered', 'unanswered'],
  bonusOutcomes: [],
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

// Bonus outcomes are variable-length (0–2) and additive, so unlike the fixed
// core five they aren't padded — a malformed entry degrades to 'unanswered',
// and a non-array degrades to no bonus dots.
function normalizeBonusOutcomes(value: unknown): SlotOutcome[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, 2)
    .map((candidate) =>
      typeof candidate === 'string' && VALID_OUTCOMES.has(candidate as SlotOutcome)
        ? (candidate as SlotOutcome)
        : ('unanswered' as SlotOutcome),
    )
}

function outcomeLabel(outcome: SlotOutcome): string {
  return outcome === 'correct'
    ? 'Correct'
    : outcome === 'incorrect'
      ? 'Wrong'
      : outcome === 'skipped'
        ? 'Skipped'
        : 'Not answered'
}

function OutcomeDot({ outcome, label }: { outcome: SlotOutcome; label: string }) {
  const isFilled = outcome !== 'unanswered'
  const background =
    outcome === 'correct'
      ? 'var(--game-correct)'
      : outcome === 'incorrect'
        ? 'var(--game-wrong-strong)'
        : outcome === 'skipped'
          ? 'color-mix(in srgb, var(--brand-ink) 35%, transparent)'
          : 'transparent'
  return (
    <span
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
}

export default function TodaysFiveCard({
  initialStatus = null,
  initialMissedCount = 0,
}: TodaysFiveCardProps = {}) {
  const [status, setStatus] = useState<DailyStatus | null>(initialStatus)
  // Client-only reset-time label; null during SSR to keep hydration stable.
  const resetDayTime = useSyncExternalStore(
    subscribeNoop,
    getResetTimeSnapshot,
    getResetTimeServerSnapshot,
  )
  // Skip the initial /api/daily/status fetch when the server already provided it.
  const skipInitialFetchRef = useRef(initialStatus !== null)

  useEffect(() => {
    if (skipInitialFetchRef.current) {
      skipInitialFetchRef.current = false
      return
    }
    let cancelled = false

    async function loadStatus() {
      try {
        const statusResponse = await fetch('/api/daily/status', {
          cache: 'no-store',
          credentials: 'include',
        })
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
          bonusOutcomes: normalizeBonusOutcomes(body.bonusOutcomes),
        })
      } catch {
        if (!cancelled) setStatus(FALLBACK_STATUS)
      }
    }

    void loadStatus()

    return () => {
      cancelled = true
    }
  }, [])

  // Background pre-build of today's Daily Five from Home (B-PERF prewarm,
  // option 3). When the server-resolved status shows no queue built yet
  // (queueId === null) and the round isn't already complete, kick off the
  // idempotent generation POST so /daily is warm by the time the player taps
  // "Play now" — turning the long synchronous loading screen into an instant
  // open. `keepalive` lets the request survive the navigation to /daily.
  //
  // Safe and bounded: fillDailyQueueForUser is idempotent and persists through a
  // (userId, queueDate) upsert, so this racing the daily cron, the login/
  // onboarding pre-warm, or the /daily POST can't produce a duplicate or partial
  // queue — the only cost of a lost race is one re-billed build. Fires at most
  // once per mount.
  const prefetchedRef = useRef(false)
  useEffect(() => {
    if (prefetchedRef.current) return
    if (!status) return
    if (status.queueId || status.isComplete || status.questionsRemaining <= 0) return
    prefetchedRef.current = true
    void fetch('/api/daily/queue', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      keepalive: true,
    }).catch(() => {
      // Best-effort warm-up — a failure just means /daily builds on open as before.
    })
  }, [status])

  const effectiveStatus = status ?? FALLBACK_STATUS
  const answered = Math.max(0, Math.min(effectiveStatus.questionsAnswered, 5))
  const isComplete =
    effectiveStatus.isComplete || effectiveStatus.questionsRemaining <= 0
  const hasStartedRound = Boolean(effectiveStatus.queueId) && answered > 0
  // Bonus dots are an in-progress/after-the-fact detail: before the player has
  // touched today's round we show just the clean five (hiding the +N friend
  // bonus group). Once they've started — or finished — the bonus group appears.
  const showBonusDots =
    effectiveStatus.bonusOutcomes.length > 0 && (hasStartedRound || isComplete)
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
  const forwardBeat = resetDayTime
    ? `Five new ${resetDayTime}`
    : 'Five new tomorrow'
  const subtext = answered > 0 ? `${answered} of 5 answered` : 'Ready when you are'
  // Editorial serif headline (display/Body-Serif), contextual to round state.
  // Completed splits on whether there are misses to revisit: Branch A turns the
  // forward beat into the "learn from your misses" nudge that the Play Missed
  // Questions sage button answers; Branch B points forward to the next round.
  const headline = isComplete
    ? missedCount > 0
      ? 'Contain more multitudes'
      : 'More questions, on the way'
    : hasStartedRound
      ? 'Pick up where you left off'
      : 'Ready when you are!'

  return (
    <div
      data-tour="five"
      className="text-card-foreground w-full rounded-[var(--radius-xs)] border border-[var(--brand-border)] bg-[var(--feed-card-elevated)] px-4 py-4 shadow-[var(--shadow-card)]"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-quiet font-semibold tracking-eyebrow text-[var(--brand-ink-700)] uppercase">
          Today&apos;s Five
        </p>
        {/* Customize pill — the entry point for tuning the Daily Five. A quiet
            cream utility pill (sliders icon + label) replacing the easy-to-miss
            gear: noticeable but clearly secondary to the Play now CTA (rounded-
            full utility shape, not the primary button's radius; navy --brand-ink
            on a near-card cream fill + softened hairline border, no shadow so it
            reads as part of the header rather than a floating chip). The row is
            items-center so the pill sits on the "Today's Five" eyebrow baseline.
            Destination is /daily/setup — the dedicated manage-your-topics page
            (adds at top, tap a circle for frequency/remove/related). The 44px
            min height keeps the tap target accessible; `shrink-0` protects it
            from being squeezed by the eyebrow on narrow widths. */}
        <Link
          href="/daily/setup"
          data-tour="customize"
          className={CUSTOMIZE_DAILY_LINK_CLASS}
          aria-label="Customize your Daily Five"
        >
          <SlidersHorizontal
            className="size-4 sm:size-[18px]"
            strokeWidth={2.4}
            aria-hidden="true"
          />
          <span>Customize</span>
        </Link>
      </div>

      <h2
        className={
          isComplete
            ? 'mt-1 mb-2 font-serif type-page-title leading-[28px] font-medium tracking-page text-[var(--brand-ink)]'
            : 'mt-1 mb-2 font-serif type-display-title leading-[40px] font-medium tracking-page text-[var(--brand-ink)]'
        }
      >
        {headline}
      </h2>

      {/* One continuous track (D-F1): the core five, then — only when this round
          carries +2 bonus questions — a visible separator, the bonus dots, and a
          generic "+{N} friend bonus" label. The bonus group is set apart by
          the gap + label (real text), never by color, and never enters the "of 5"
          count. With no bonus this is exactly the original five-dot row. */}
      <div
        className="mt-3 flex items-center gap-2"
        aria-label={`${answered} of 5 answered`}
      >
        {effectiveStatus.slotOutcomes.slice(0, 5).map((outcome, index) => (
          <OutcomeDot key={`core-${index}`} outcome={outcome} label={outcomeLabel(outcome)} />
        ))}
        {showBonusDots ? (
          <>
            <span
              aria-hidden
              className="mx-0.5 h-3 w-px shrink-0"
              style={{ background: 'color-mix(in srgb, var(--brand-ink) 28%, transparent)' }}
            />
            {effectiveStatus.bonusOutcomes.map((outcome, index) => (
              <OutcomeDot
                key={`bonus-${index}`}
                outcome={outcome}
                label={`Bonus ${index + 1} of ${effectiveStatus.bonusOutcomes.length}, from friends: ${outcomeLabel(outcome)}`}
              />
            ))}
            <span className="ml-1 type-metadata font-medium text-[var(--brand-ink-400)]">
              +{effectiveStatus.bonusOutcomes.length} friend bonus
            </span>
          </>
        ) : null}
      </div>

      {/* Active-state progress line. The completed state replaces this with the
          forward beat below — the forward-looking "More questions, on the way"
          headline carries the day-done moment, so the stack stays
          forward-pointing. */}
      {!isComplete && answered > 0 ? (
        <p className="mt-2.5 text-xs leading-5 text-[var(--brand-ink-400)]">
          {subtext}
        </p>
      ) : null}

      {/* Forward beat — the always-present time anchor, sitting between the
          result dots and the one forward action in both completed branches. */}
      {isComplete ? (
        <p className="mt-3 text-quiet leading-5 text-[var(--brand-ink-700)]">
          {forwardBeat}
        </p>
      ) : null}

      {isComplete ? (
        missedCount > 0 ? (
          // Branch A — outstanding catch-up questions own the only button here;
          // the home page suppresses the standalone Catch up card to match.
          // Faded-sage fill (sage border / forest-green text) — calmer and more
          // inviting than the old orange outline, still clearly secondary to the
          // day's primary Play. Built from --domain-science / --game-correct.
          // Recap stays link-weight below the button (backward-looking, no arrow).
          <div className="mt-3 space-y-2.5">
            <Link
              href="/daily/catchup"
              className="flex min-h-12 w-full items-center justify-center rounded-[var(--radius-xs)] border border-[color-mix(in_srgb,var(--domain-science)_55%,transparent)] bg-[color-mix(in_srgb,var(--domain-science)_22%,transparent)] text-base font-semibold tracking-normal text-[var(--game-correct)] transition-colors hover:bg-[color-mix(in_srgb,var(--domain-science)_32%,transparent)]"
            >
              {`Play (${missedCount}) Missed Question${missedCount === 1 ? '' : 's'}`}
            </Link>
            <Link
              href="/daily/summary"
              className="block text-sm font-medium text-[var(--brand-link)] underline underline-offset-4"
            >
              See today&apos;s recap
            </Link>
          </div>
        ) : (
          // Branch B — nothing left to catch up on (daily five AND any catch-up
          // questions done). This is the calmest completed state, so it carries
          // no button: the day's work is finished. All three nudges sit on one
          // quiet link row (wraps on narrow widths) — Find friends routes to the
          // canonical /friends/find destination ("Find friends →" elsewhere).
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium">
            <Link
              href="/friends/find"
              className="text-[var(--brand-link)] underline underline-offset-4 transition-colors hover:text-[var(--brand-ink)]"
            >
              Find friends →
            </Link>
            <Link
              href="/questions?create=1&intent=bank"
              className="text-[var(--brand-ink-400)] underline underline-offset-4 transition-colors hover:text-[var(--brand-ink)]"
            >
              Add a question to your bank
            </Link>
            <Link
              href="/daily/summary"
              className="text-[var(--brand-link)] underline underline-offset-4"
            >
              See today&apos;s recap
            </Link>
          </div>
        )
      ) : (
        <>
          <Link
            href={playHref}
            className="btn-primary mt-4 w-full"
          >
            {actionLabel}
          </Link>
          {missedCount > 0 ? (
            <Link
              href="/daily/catchup"
              className="mt-3 block text-sm font-medium text-[var(--brand-ink-400)] underline underline-offset-4 transition-colors hover:text-[var(--brand-ink)]"
            >
              Catch up &middot; {missedCount} missed {missedCount === 1 ? 'question' : 'questions'} &rarr;
            </Link>
          ) : null}
        </>
      )}
    </div>
  )
}
