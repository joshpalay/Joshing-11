'use client'

/**
 * First-Session Panel (B-FirstRecap-1, reworked).
 *
 * Replaces the old full-screen Daily Five "first session" cinematic. For a
 * user's first completed Daily Five we now show a quiet inline panel at the top
 * of the session recap instead of taking over the screen: a short "nice start",
 * the daily-cadence note with a link to change which questions you get, and the
 * reminder opt-in (reused from the returning-user prompt). The recap itself is
 * the reward.
 *
 * The reminder ask used to appear twice for first-timers — once in the
 * cinematic's Beat 4 and again in the page's bottom RoundReminderCard. It now
 * lives only here; the page suppresses the bottom card while this panel shows.
 *
 * The seen-signal is persisted the moment the panel mounts so refresh /
 * re-entry never re-trigger it.
 */

import Link from 'next/link'
import { useEffect } from 'react'

import { RoundReminderCard } from './RoundReminderCard'
import type { FirstSessionRecapView } from '@/server/daily/first-session-recap'

export function FirstSessionPanel({ recap }: { recap: FirstSessionRecapView }) {
  // Persist the seen-signal as soon as the panel shows — re-entry, refresh, and
  // replaying catch-up must never re-trigger it. Fire-and-forget.
  useEffect(() => {
    fetch('/api/daily/first-session-recap/seen', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => undefined)
  }, [])

  return (
    <>
      <section className="mt-6 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-card)] px-5 py-5">
        <p className="text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          First five complete
        </p>
        <h2 className="mt-2 font-serif text-2xl leading-tight text-[var(--brand-ink)]">
          Nice start{recap.firstName ? `, ${recap.firstName}` : ''}.
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--brand-ink-700)]">
          Five new questions come every day. Want different ones?{' '}
          <Link
            href="/daily/setup"
            className="text-[var(--brand-link)] underline underline-offset-4"
          >
            Set your topics here
          </Link>
          .
        </p>
      </section>

      <RoundReminderCard
        title="Want a reminder when new questions land?"
        description="One message a day, max. You can turn it off any time."
      />
    </>
  )
}
