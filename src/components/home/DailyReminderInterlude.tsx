'use client'

import Link from 'next/link'
import { useState } from 'react'

// A short, full-bleed teal band that sits directly under the daily-five card and
// invites the viewer to turn on the daily reminder email. It is way less tall
// than the editorial interludes (Overlap / Find friends / Write) by design — a
// utility prompt, not a discovery moment.
//
// It reuses the existing reminder machinery (PATCH /api/account/reminders): a
// viewer with a verified email opts in with one tap; everyone else submits an
// email inline (collect -> verify -> opt-in, the same flow as the daily-summary
// RoundReminderCard). Dismissing posts { dismissed: true }, which sets
// reminderPromptDismissedAt — so the band never returns. The server only renders
// this when the viewer is not opted in and has not dismissed (see page.tsx), so
// signing up or dismissing anywhere silences it everywhere.

async function patchReminders(body: Record<string, unknown>): Promise<boolean> {
  const response = await fetch('/api/account/reminders', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.ok
}

type State =
  | { kind: 'collapsed' }
  | { kind: 'expanded'; value: string; error: string | null; saving: boolean }
  | { kind: 'opting-in' }
  | { kind: 'saved'; message: string }
  | { kind: 'dismissing' }
  | { kind: 'hidden' }

export function DailyReminderInterlude({
  hasVerifiedEmail,
}: {
  // When the viewer already has a verified email, the CTA is a one-tap opt-in;
  // otherwise it expands an inline email field.
  hasVerifiedEmail: boolean
}) {
  const [state, setState] = useState<State>({ kind: 'collapsed' })

  if (state.kind === 'hidden') return null

  async function dismiss() {
    setState({ kind: 'dismissing' })
    const ok = await patchReminders({ dismissed: true })
    setState(ok ? { kind: 'hidden' } : { kind: 'collapsed' })
  }

  async function optInWithVerifiedEmail() {
    setState({ kind: 'opting-in' })
    const ok = await patchReminders({ emailOptIn: 'opted_in' })
    setState(
      ok
        ? { kind: 'saved', message: "You're set — we'll email you when each day's five opens." }
        : { kind: 'collapsed' },
    )
  }

  const busy = state.kind === 'dismissing' || state.kind === 'opting-in'

  return (
    // -mx-4 escapes the home <main>'s px-4 gutter so the band reaches the column
    // edges (full-bleed); the short py keeps it a fraction of the editorial
    // interludes' height. The main's gap-5 handles separation from its neighbors.
    <section className="relative -mx-4 bg-[var(--interlude-teal)] px-8 py-6">
      <button
        type="button"
        onClick={dismiss}
        disabled={busy}
        aria-label="Dismiss daily reminder prompt"
        className="absolute top-2 right-2 grid size-8 place-items-center rounded-full text-[var(--cream)]/70 transition hover:text-[var(--cream)] focus-visible:ring-2 focus-visible:ring-[var(--cream)] focus-visible:outline-none disabled:opacity-40"
      >
        <span aria-hidden="true" className="text-base leading-none">
          ✕
        </span>
      </button>

      <h2 className="max-w-[24ch] pr-8 font-serif text-[22px] leading-[1.15] font-medium text-[var(--cream)]">
        Don&rsquo;t miss your next set of questions.
      </h2>

      {state.kind === 'saved' ? (
        <p className="mt-3 text-quiet leading-5 text-[var(--cream)]/90">
          {state.message}{' '}
          <Link
            href="/users/me#notifications"
            className="underline underline-offset-2 hover:text-[var(--cream)]"
          >
            Manage in settings
          </Link>
        </p>
      ) : state.kind === 'expanded' ? (
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start"
          onSubmit={async (event) => {
            event.preventDefault()
            if (state.kind !== 'expanded') return
            const trimmed = state.value.trim()
            if (!trimmed) {
              setState({ ...state, error: 'Please enter an email address.' })
              return
            }
            setState({ ...state, saving: true, error: null })
            const ok = await patchReminders({ pendingEmail: trimmed })
            setState(
              ok
                ? { kind: 'saved', message: `Got it — we'll verify ${trimmed} and email you each day.` }
                : { ...state, saving: false, error: 'Could not save. Try again.' },
            )
          }}
        >
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            value={state.value}
            disabled={state.saving}
            onChange={(event) =>
              setState((prev) =>
                prev.kind === 'expanded'
                  ? { ...prev, value: event.target.value, error: null }
                  : prev,
              )
            }
            className="min-h-11 flex-1 rounded-[var(--radius-md)] border border-[var(--cream-accent)] bg-[var(--brand-field)] px-3 py-2 text-sm text-[var(--brand-ink)] outline-none focus:border-[var(--brand-navy)]"
          />
          <button
            type="submit"
            disabled={state.saving}
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-card)] bg-[var(--cream)] px-4 py-2 font-sans text-quiet font-semibold tracking-[0.12em] text-[var(--ink)] uppercase transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--cream)] focus-visible:outline-none disabled:opacity-45"
          >
            {state.saving ? 'Saving…' : 'Email me'}
          </button>
        </form>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            hasVerifiedEmail
              ? optInWithVerifiedEmail()
              : setState({ kind: 'expanded', value: '', error: null, saving: false })
          }
          className="mt-3 inline-flex min-h-11 items-center font-sans text-quiet font-medium tracking-[0.12em] text-[var(--cream)] uppercase underline underline-offset-4 transition hover:opacity-80 disabled:opacity-45"
        >
          {state.kind === 'opting-in' ? 'Saving…' : 'Turn on daily reminders →'}
        </button>
      )}

      {state.kind === 'expanded' && state.error ? (
        <p className="mt-2 text-xs text-[var(--cream)]/90">{state.error}</p>
      ) : null}
    </section>
  )
}
