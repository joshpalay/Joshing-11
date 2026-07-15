'use client'

import { useEffect, useState } from 'react'

import { Eyebrow, Reveal, Shell, roomTheme } from '@/components/ceremony/room'
import { usePrefersReducedMotion } from '@/components/feed/usePrefersReducedMotion'

// D-REMINDER-INTERSTITIAL-01 — the one-time, full-screen email-reminder ask.
// Fires when a player leaves the daily summary via a `/` path (E1), at most once
// per account. It is a single ceremony ROOM (Decision I): the navy TH.open
// ground, ochre accent, staggered reveal — reusing the shared Shell/Reveal/
// Eyebrow primitives. Deliberately NOT the ceremony's tap-to-advance: this is
// one room with two equal-weight buttons (G1), not a story. No ✕ — a third exit
// would be ambiguous against "Not now" and need its own write path.
//
// Both buttons stamp reminder_interstitial_seen_at (so it never re-fires) and
// then proceed to `/` (Decision F1 — honor the exit the player pressed). Skip
// (`Not now`) writes ONLY the seen column, never reminder_prompt_dismissed_at
// (Decision D) — the standing inline RoundReminderCard lives on.

async function patchReminders(body: Record<string, unknown>): Promise<boolean> {
  try {
    const response = await fetch('/api/account/reminders', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return response.ok
  } catch {
    return false
  }
}

type State =
  // Two equal-weight buttons: "Email me" / "Not now".
  | { kind: 'ask' }
  // No verified email on file — collect one inline before opting in.
  | { kind: 'collect'; value: string; error: string | null; saving: boolean }
  // A seen-stamping PATCH is in flight (verified one-tap opt-in, or skip).
  | { kind: 'working' }
  // Signed up — a short acknowledgement before proceeding home.
  | { kind: 'done'; message: string }

export function ReminderInterstitial({
  hasVerifiedEmail,
  onProceed,
}: {
  // When the player already has a verified email, "Email me" opts them in with
  // one tap; otherwise it expands an inline email field.
  hasVerifiedEmail: boolean
  // Called once the seen-stamp has been attempted (best-effort), to deliver the
  // player to the `/` exit they originally pressed. Never blocks on the network.
  onProceed: () => void
}) {
  const reduced = usePrefersReducedMotion()
  const th = roomTheme('open')
  const [state, setState] = useState<State>({ kind: 'ask' })

  // Staggered reveal on mount (CSS transition-delay via Reveal). Under reduced
  // motion, Reveal shows its children immediately with no transition.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  async function skip() {
    setState({ kind: 'working' })
    await patchReminders({ interstitialSeen: true })
    onProceed()
  }

  async function optInWithVerifiedEmail() {
    setState({ kind: 'working' })
    const ok = await patchReminders({ emailOptIn: 'opted_in', interstitialSeen: true })
    if (ok) {
      setState({
        kind: 'done',
        message: "You're set. We'll email you when each day's five open.",
      })
      return
    }
    // Signup failed but the ask is spent — stamp seen and let them leave rather
    // than trapping them on a broken room.
    onProceed()
  }

  const busy = state.kind === 'working' || (state.kind === 'collect' && state.saving)

  const fieldStyle = {
    borderColor: th.accent,
    backgroundColor: 'var(--brand-field)',
    color: 'var(--brand-ink)',
  }

  return (
    <div
      className="fixed inset-0 z-[var(--z-takeover)]"
      role="dialog"
      aria-modal="true"
      aria-label="Turn on daily reminders"
    >
      <Shell th={th}>
        <Reveal show={shown} reduced={reduced}>
          <Eyebrow color={th.accent}>Before you go</Eyebrow>
        </Reveal>

        <Reveal show={shown} delay={reduced ? 0 : 0.08} reduced={reduced}>
          <h1
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 40,
              lineHeight: 1.06,
              fontWeight: 500,
              color: th.fg,
              marginBottom: 20,
            }}
          >
            Tomorrow&rsquo;s five are already written.
          </h1>
        </Reveal>

        {state.kind === 'done' ? (
          <Reveal show reduced={reduced}>
            <p style={{ fontSize: 16, lineHeight: 1.55, color: th.fg, marginBottom: 28 }}>
              {state.message}
            </p>
            <button
              type="button"
              onClick={onProceed}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full px-5 text-sm font-semibold uppercase tracking-[0.12em] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2"
              style={{ backgroundColor: th.fg, color: th.bg }}
            >
              Home
            </button>
          </Reveal>
        ) : (
          <>
            <Reveal show={shown} delay={reduced ? 0 : 0.16} reduced={reduced}>
              <p style={{ fontSize: 16, lineHeight: 1.55, color: th.sub, marginBottom: 28 }}>
                We&rsquo;ll email you when they open. That&rsquo;s the whole thing &mdash; one
                note a day, and only when there&rsquo;s something new to find out.
              </p>
            </Reveal>

            {state.kind === 'collect' ? (
              <Reveal show reduced={reduced}>
                <form
                  className="flex flex-col gap-3"
                  onSubmit={async (event) => {
                    event.preventDefault()
                    if (state.kind !== 'collect') return
                    const trimmed = state.value.trim()
                    if (!trimmed) {
                      setState({ ...state, error: 'Please enter an email address.' })
                      return
                    }
                    setState({ ...state, saving: true, error: null })
                    const ok = await patchReminders({
                      pendingEmail: trimmed,
                      interstitialSeen: true,
                    })
                    if (!ok) {
                      setState({ ...state, saving: false, error: 'Could not save. Try again.' })
                      return
                    }
                    setState({
                      kind: 'done',
                      message: `Check ${trimmed} to confirm, and we'll email you when each day's five open.`,
                    })
                  }}
                >
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    autoFocus
                    placeholder="you@example.com"
                    value={state.value}
                    disabled={state.saving}
                    onChange={(event) =>
                      setState((prev) =>
                        prev.kind === 'collect'
                          ? { ...prev, value: event.target.value, error: null }
                          : prev,
                      )
                    }
                    className="min-h-11 w-full rounded-[var(--radius-md)] border px-3 py-2 text-sm outline-none"
                    style={fieldStyle}
                  />
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button
                      type="submit"
                      disabled={state.saving}
                      className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full px-5 text-sm font-semibold uppercase tracking-[0.12em] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
                      style={{ backgroundColor: th.fg, color: th.bg }}
                    >
                      {state.saving ? 'Saving…' : 'Email me'}
                    </button>
                    <button
                      type="button"
                      disabled={state.saving}
                      onClick={skip}
                      className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border px-5 text-sm font-semibold uppercase tracking-[0.12em] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
                      style={{ borderColor: th.fg, color: th.fg }}
                    >
                      Not now
                    </button>
                  </div>
                  {state.error ? (
                    <p style={{ fontSize: 13, color: th.fg }} role="alert">
                      {state.error}
                    </p>
                  ) : null}
                </form>
              </Reveal>
            ) : (
              <Reveal show={shown} delay={reduced ? 0 : 0.24} reduced={reduced}>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      hasVerifiedEmail
                        ? optInWithVerifiedEmail()
                        : setState({ kind: 'collect', value: '', error: null, saving: false })
                    }
                    className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full px-5 text-sm font-semibold uppercase tracking-[0.12em] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
                    style={{ backgroundColor: th.fg, color: th.bg }}
                  >
                    Email me
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={skip}
                    className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border px-5 text-sm font-semibold uppercase tracking-[0.12em] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
                    style={{ borderColor: th.fg, color: th.fg }}
                  >
                    Not now
                  </button>
                </div>
              </Reveal>
            )}
          </>
        )}
      </Shell>
    </div>
  )
}
