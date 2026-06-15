'use client'

import Link from 'next/link'
import { type CSSProperties, useState } from 'react'

type CardState =
  | { kind: 'idle' }
  | { kind: 'sms-saving' }
  | { kind: 'sms-confirmed' }
  | { kind: 'email-form'; value: string; error: string | null; saving: boolean }
  | { kind: 'email-saved'; email: string }
  | { kind: 'dismissing' }
  | { kind: 'hidden' }

const titleStyle: CSSProperties = {
  fontFamily: 'var(--font-neutral), system-ui, sans-serif',
  fontSize: '1.05rem',
  fontWeight: 600,
  color: '#111111',
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

export function RoundReminderCard() {
  const [state, setState] = useState<CardState>({ kind: 'idle' })

  if (state.kind === 'hidden') return null

  if (state.kind === 'sms-confirmed') {
    return (
      <section className="card mt-5 px-5 py-4">
        <h2 style={titleStyle}>Reminders</h2>
        <p className="text-foreground mt-2 text-sm leading-6">
          We&apos;ve saved your preference. Texts will start when reminders launch.
        </p>
        <p className="text-muted-foreground mt-2 text-xs">
          <Link href="/users/me#notifications" className="underline underline-offset-2">
            Manage in settings
          </Link>
        </p>
      </section>
    )
  }

  if (state.kind === 'email-saved') {
    return (
      <section className="card mt-5 px-5 py-4">
        <h2 style={titleStyle}>Reminders</h2>
        <p className="text-foreground mt-2 text-sm leading-6">
          Got it — we&apos;ll verify {state.email} and email you once reminders launch.
        </p>
        <p className="text-muted-foreground mt-2 text-xs">
          <Link href="/users/me#notifications" className="underline underline-offset-2">
            Manage in settings
          </Link>
        </p>
      </section>
    )
  }

  if (state.kind === 'email-form') {
    return (
      <section className="card mt-5 px-5 py-4">
        <h2 style={titleStyle}>Email me when the next round opens</h2>
        <form
          className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start"
          onSubmit={async (event) => {
            event.preventDefault()
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
            value={state.value}
            disabled={state.saving}
            onChange={(event) =>
              setState({ ...state, value: event.target.value, error: null })
            }
            className="bg-[var(--brand-field)] flex-1 rounded-lg border border-[var(--accent-gold)] px-3 py-2 text-sm focus:border-[var(--brand-navy)]"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="btn-primary"
              disabled={state.saving}
            >
              {state.saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={state.saving}
              onClick={() => setState({ kind: 'idle' })}
            >
              Cancel
            </button>
          </div>
        </form>
        {state.error ? (
          <p className="mt-2 text-xs text-rose-700">{state.error}</p>
        ) : null}
        <p className="text-muted-foreground mt-3 text-xs leading-5">
          We&apos;ll send a confirmation email once email reminders launch.
        </p>
      </section>
    )
  }

  const sendingSms = state.kind === 'sms-saving'
  const dismissing = state.kind === 'dismissing'
  const busy = sendingSms || dismissing

  return (
    <section className="card mt-5 px-5 py-4">
      <h2 style={titleStyle}>Want a reminder when tomorrow&apos;s round opens?</h2>
      <p className="text-foreground mt-2 text-sm leading-6">
        One message a day, max. You can turn it off any time.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          className="btn-primary sm:flex-1"
          disabled={busy}
          onClick={async () => {
            setState({ kind: 'sms-saving' })
            const ok = await patchReminders({ smsOptIn: 'opted_in' })
            setState(ok ? { kind: 'sms-confirmed' } : { kind: 'idle' })
          }}
        >
          {sendingSms ? 'Saving…' : 'Yes, text me'}
        </button>
        <button
          type="button"
          className="btn-ghost sm:flex-1"
          disabled={busy}
          onClick={() =>
            setState({ kind: 'email-form', value: '', error: null, saving: false })
          }
        >
          Use email instead
        </button>
        <button
          type="button"
          className="btn-ghost sm:flex-1"
          disabled={busy}
          onClick={async () => {
            setState({ kind: 'dismissing' })
            const ok = await patchReminders({ dismissed: true })
            setState(ok ? { kind: 'hidden' } : { kind: 'idle' })
          }}
        >
          {dismissing ? 'Saving…' : 'No thanks'}
        </button>
      </div>
    </section>
  )
}
