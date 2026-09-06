'use client'

/**
 * First-Session Panel (B-FirstRecap-1, trimmed).
 *
 * For a user's first completed Daily Five we show a quiet inline panel at the
 * top of the session recap instead of taking over the screen. It is a single
 * short card: a "nice start", the daily-cadence note (with the time and when
 * the next set lands), and a link to change which questions you get.
 *
 * The earlier versions of this panel also carried a social "beat 3" (connect to
 * an inviter / invite-a-friend) and a reminder opt-in. Both were removed from
 * this card; the separately gated reminder prompt handles the single follow-up
 * opportunity for players who skipped it during setup. The seen-signal is still
 * persisted the moment the panel mounts so refresh / re-entry never re-trigger it.
 */

import Link from 'next/link'
import { useEffect, useMemo } from 'react'

import type { FirstSessionRecapView } from '@/server/daily/first-session-recap'

export function FirstSessionPanel({
  recap,
  preview = false,
}: {
  recap: FirstSessionRecapView
  /**
   * Read-only replay (dev harness): renders the real panel but suppresses its
   * side effects, so it never records the one-time "seen" signal.
   */
  preview?: boolean
}) {
  // Persist the seen-signal as soon as the panel shows — re-entry, refresh, and
  // replaying catch-up must never re-trigger it. Fire-and-forget. Skipped in
  // preview so a harness replay never burns the one-time flag.
  useEffect(() => {
    if (preview) return
    fetch('/api/daily/first-session-recap/seen', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => undefined)
  }, [preview])

  // The next Daily Five lands tomorrow at noon (matches the summary page copy).
  // Name the weekday so the cadence reads concretely.
  const nextWeekday = useMemo(() => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    return tomorrow.toLocaleDateString(undefined, { weekday: 'long' })
  }, [])

  return (
    <section className="mt-6 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-card)] px-5 py-5">
      {/* Deliberately does NOT claim the round is finished. This panel is gated
          on "first session with at least one answer" (computeReminderPromptState:
          todayAnswered > 0 and no prior day with an answered slot), which a
          player hits after a single answer — so "First five complete" announced
          a completion that had not happened, while home simultaneously offered
          "Resume round · 2 of 5 answered". The panel's job is orientation
          (cadence + where to change topics), not congratulation. */}
      <p className="text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        Your first session
      </p>
      <h2 className="mt-2 font-serif text-2xl leading-tight text-[var(--brand-ink)]">
        Nice start{recap.firstName ? `, ${recap.firstName}` : ''}.
      </h2>
      <p className="mt-2 text-sm leading-6 text-[var(--brand-ink-700)]">
        New questions come every day at noon — next up {nextWeekday} at noon. You
        can change the types of questions anytime on{' '}
        <Link
          href="/knowledge"
          className="text-[var(--brand-link)] underline underline-offset-4"
        >
          your Knowledge page
        </Link>
        .
      </p>
    </section>
  )
}
