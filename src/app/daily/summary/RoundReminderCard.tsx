'use client'

import Link from 'next/link'
import { type CSSProperties, useState } from 'react'

// SMS reminders aren't available, so the opt-in is email-only: the card shows
// an email field inline (no "Yes, text me" / "Use email instead" fork) plus a
// "No thanks" dismiss. The API still accepts smsOptIn for other callers; this
// card just never sends it.
type CardState =
  | { kind: 'idle'; value: string; error: string | null; saving: boolean }
  | { kind: 'email-saved'; email: string }
  | { kind: 'dismissing' }
  | { kind: 'hidden' }

const titleStyle: CSSProperties = {
  fontFamily: 'var(--font-neutral), system-ui, sans-serif',
  fontSize: '1.05rem',
  fontWeight: 600,
  color: 'var(--ink)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

async function patchReminders(body: Record<string, unknown>): Promise<boolean> {
  const response = await fetch('/api/account/reminders', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.ok
}

const DEFAULT_TITLE = "Want a reminder when tomorrow's round opens?"
const DEFAULT_DESCRIPTION = 'One message a day, max. You can turn it off any time.'

export function RoundReminderCard({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
}: {
  title?: string
  description?: string
} = {}) {
  const [state, setState] = useState<CardState>({
    kind: 'idle',
    value: '',
    error: null,
    saving: false,
  })

  if (state.kind === 'hidden') return null

  if (state.kind === 'email-saved') {
    return (
      <section className="card mt-5 px-5 py-4">
        <h2 style={titleStyle}>Reminders</h2>
        <p className="text-foreground mt-2 text-sm leading-6">
          Got it — we&apos;ll verify {state.email} and email you when each day&apos;s five open.
        </p>
        <p className="text-muted-foreground mt-2 text-xs">
          <Link href="/users/me#notifications" className="underline underline-offset-2">
            Manage in settings
          </Link>
        </p>
      </section>
    )
  }

  const dismissing = state.kind === 'dismissing'
  const saving = state.kind === 'idle' && state.saving
  const busy = dismissing || saving

  return (
    <section className="card mt-5 px-5 py-4">
      <h2 style={titleStyle}>{title}</h2>
      <p className="text-foreground mt-2 text-sm leading-6">{description}</p>
      <form
        className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start"
        onSubmit={async (event) => {
          event.preventDefault()
          if (state.kind !== 'idle') return
          const trimmed = state.value.trim()
          if (!trimmed) {
            setState({ ...state, error: 'Please enter an email address.' })
            return
          }
          setState({ ...state, saving: true, error: null })
          const ok = await patchReminders({ pendingEmail: trimmed })
          if (!ok) {
            setState({ ...state, saving: false, error: 'Could not save. Try again.' })
            return
          }
          setState({ kind: 'email-saved', email: trimmed })
        }}
      >
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          value={state.kind === 'idle' ? state.value : ''}
          disabled={busy}
          onChange={(event) =>
            setState((prev) =>
              prev.kind === 'idle'
                ? { ...prev, value: event.target.value, error: null }
                : prev,
            )
          }
          className="bg-[var(--brand-field)] flex-1 rounded-lg border border-[var(--accent-gold)] px-3 py-2 text-sm focus:border-[var(--brand-navy)]"
        />
        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={busy}>
            {saving ? 'Saving…' : 'Email me'}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={async () => {
              setState({ kind: 'dismissing' })
              const ok = await patchReminders({ dismissed: true })
              setState(
                ok
                  ? { kind: 'hidden' }
                  : { kind: 'idle', value: '', error: null, saving: false },
              )
            }}
          >
            {dismissing ? 'Saving…' : 'No thanks'}
          </button>
        </div>
      </form>
      {state.kind === 'idle' && state.error ? (
        <p className="mt-2 text-xs text-rose-700">{state.error}</p>
      ) : null}
      <p className="text-muted-foreground mt-3 text-xs leading-5">
        We&apos;ll send one note to confirm it&apos;s you, then a reminder the moment each day&apos;s five open.
      </p>
    </section>
  )
}
