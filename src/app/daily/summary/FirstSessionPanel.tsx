'use client'

/**
 * First-Session Panel (B-FirstRecap-1, reworked).
 *
 * Replaces the old full-screen Daily Five "first session" cinematic. For a
 * user's first completed Daily Five we now show a quiet inline panel at the top
 * of the session recap instead of taking over the screen. It is a SINGLE card:
 * a short "nice start", the daily-cadence note (with the time and when the next
 * set lands) and a link to change which questions you get, then the reminder
 * opt-in merged into the same box.
 *
 * The reminder ask is email-only (SMS isn't available) and has no dismiss: the
 * recap and the ask share one card now, so there's nothing to dismiss
 * independently. This deliberately diverges from the standalone, recurring
 * `RoundReminderCard` shown to returning users, which keeps its "No thanks"
 * because dismissing it durably suppresses that recurring prompt.
 *
 * The seen-signal is persisted the moment the panel mounts so refresh /
 * re-entry never re-trigger it.
 */

import Link from 'next/link'
import { type CSSProperties, useEffect, useMemo, useState } from 'react'

import type {
  FirstSessionRecapBeat3,
  FirstSessionRecapView,
} from '@/server/daily/first-session-recap'

// Mirrors RoundReminderCard's `titleStyle` so the merged reminder ask reads
// identically to the standalone opt-in.
const reminderTitleStyle: CSSProperties = {
  fontFamily: 'var(--font-neutral), system-ui, sans-serif',
  fontSize: '1.05rem',
  fontWeight: 600,
  color: '#111111',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

// Beat 3 (social). Pure presentation over the server-computed `beat3` branch:
// connect a new player to whoever (if anyone) invited them, or — for organic
// signups — fall back to an invite-a-friend CTA. Styled to match the reminder
// block below so the two reads as one register.
function SocialBeat({ beat3 }: { beat3: FirstSessionRecapBeat3 }) {
  if (beat3.kind === 'inviter_present') {
    const { inviterName } = beat3
    return (
      <div className="mt-5 border-t border-[var(--brand-border)] pt-5">
        <h3 style={reminderTitleStyle}>{inviterName} is already in your game</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--brand-ink-700)]">
          Some of the questions in your feed are ones {inviterName} answered —
          look for the{' '}
          <span className="font-semibold text-[var(--brand-ink)]">
            Via {inviterName}
          </span>{' '}
          label, and answer one back.
        </p>
        <p className="mt-3 text-sm leading-6">
          <Link
            href="/#feed"
            className="text-[var(--brand-link)] underline underline-offset-4"
          >
            Go to your feed
          </Link>
        </p>
      </div>
    )
  }

  if (beat3.kind === 'inviter_future') {
    const { inviterName } = beat3
    return (
      <div className="mt-5 border-t border-[var(--brand-border)] pt-5">
        <h3 style={reminderTitleStyle}>You&apos;re connected with {inviterName}</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--brand-ink-700)]">
          When {inviterName} plays, their questions will land in your feed marked{' '}
          <span className="font-semibold text-[var(--brand-ink)]">
            Via {inviterName}
          </span>
          .
        </p>
      </div>
    )
  }

  // no_inviter — copy is DRAFT, pending review (see PR).
  return (
    <div className="mt-5 border-t border-[var(--brand-border)] pt-5">
      <h3 style={reminderTitleStyle}>Joshing is better with a friend in it</h3>
      <p className="mt-2 text-sm leading-6 text-[var(--brand-ink-700)]">
        Bring someone you like to outsmart — their questions show up in your feed,
        and yours in theirs.
      </p>
      <p className="mt-3 text-sm leading-6">
        <Link
          href="/friends"
          className="text-[var(--brand-link)] underline underline-offset-4"
        >
          Invite a friend
        </Link>
      </p>
    </div>
  )
}

type EmailState =
  | { kind: 'idle'; value: string; error: string | null; saving: boolean }
  | { kind: 'saved'; email: string }

export function FirstSessionPanel({
  recap,
  preview = false,
}: {
  recap: FirstSessionRecapView
  /**
   * Read-only replay (dev harness): renders the real panel — including
   * `recap.beat3` — but suppresses its side effects, so it never records the
   * one-time "seen" signal or PATCHes reminder settings.
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

  const [email, setEmail] = useState<EmailState>({
    kind: 'idle',
    value: '',
    error: null,
    saving: false,
  })

  // The next Daily Five lands tomorrow at noon (matches the summary page copy).
  // Name the weekday so the cadence reads concretely.
  const nextWeekday = useMemo(() => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    return tomorrow.toLocaleDateString(undefined, { weekday: 'long' })
  }, [])

  const saving = email.kind === 'idle' && email.saving

  return (
    <section className="mt-6 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-card)] px-5 py-5">
      <p className="text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        First five complete
      </p>
      <h2 className="mt-2 font-serif text-2xl leading-tight text-[var(--brand-ink)]">
        Nice start{recap.firstName ? `, ${recap.firstName}` : ''}.
      </h2>
      <p className="mt-2 text-sm leading-6 text-[var(--brand-ink-700)]">
        New questions come every day at noon — next up {nextWeekday} at noon. You
        can update your topics anytime on the{' '}
        <Link
          href="/daily/setup"
          className="text-[var(--brand-link)] underline underline-offset-4"
        >
          Shape your next round
        </Link>{' '}
        page.
      </p>

      <SocialBeat beat3={recap.beat3} />

      {/* Reminder opt-in, merged into the same card. Email-only, no dismiss. */}
      <div className="mt-5 border-t border-[var(--brand-border)] pt-5">
        {email.kind === 'saved' ? (
          <>
            <h3 style={reminderTitleStyle}>Reminders</h3>
            <p className="text-foreground mt-2 text-sm leading-6">
              Got it — we&apos;ll verify {email.email} and email you once reminders
              launch.
            </p>
            <p className="text-muted-foreground mt-2 text-xs">
              <Link
                href="/users/me#notifications"
                className="underline underline-offset-2"
              >
                Manage in settings
              </Link>
            </p>
          </>
        ) : (
          <>
            <h3 style={reminderTitleStyle}>
              Get notified when the next batch is available
            </h3>
            <p className="text-foreground mt-2 text-sm leading-6">
              We can email you when new questions land.
            </p>
            <form
              className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start"
              onSubmit={async (event) => {
                event.preventDefault()
                if (email.kind !== 'idle') return
                const trimmed = email.value.trim()
                if (!trimmed) {
                  setEmail({ ...email, error: 'Please enter an email address.' })
                  return
                }
                setEmail({ ...email, saving: true, error: null })
                // Preview replay — show the saved state without the PATCH.
                if (preview) {
                  setEmail({ kind: 'saved', email: trimmed })
                  return
                }
                const response = await fetch('/api/account/reminders', {
                  method: 'PATCH',
                  credentials: 'include',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ pendingEmail: trimmed }),
                }).catch(() => null)
                if (!response || !response.ok) {
                  setEmail({ ...email, saving: false, error: 'Could not save. Try again.' })
                  return
                }
                setEmail({ kind: 'saved', email: trimmed })
              }}
            >
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
                value={email.kind === 'idle' ? email.value : ''}
                disabled={saving}
                onChange={(event) =>
                  setEmail((prev) =>
                    prev.kind === 'idle'
                      ? { ...prev, value: event.target.value, error: null }
                      : prev,
                  )
                }
                className="bg-[var(--brand-field)] flex-1 rounded-lg border border-[var(--accent-gold)] px-3 py-2 text-sm focus:border-[var(--brand-navy)]"
              />
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Email me'}
              </button>
            </form>
            {email.kind === 'idle' && email.error ? (
              <p className="mt-2 text-xs text-rose-700">{email.error}</p>
            ) : null}
            <p className="text-muted-foreground mt-3 text-xs leading-5">
              We&apos;ll send a confirmation email once email reminders launch.
            </p>
          </>
        )}
      </div>
    </section>
  )
}
