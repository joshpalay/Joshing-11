'use client'

import { useEffect, useState } from 'react'

import { Eyebrow, Reveal, Shell, roomTheme } from '@/components/ceremony/room'
import { usePrefersReducedMotion } from '@/components/feed/usePrefersReducedMotion'
import { SmsReminderDisclosure } from '@/components/reminders/SmsReminderDisclosure'

// D-REMINDER-INTERSTITIAL-01 — the one-time, full-screen SMS-reminder ask.
// Fires when a player who skipped onboarding reminders leaves the daily summary
// via a `/` path, at most once per account. It is a single ceremony ROOM: the navy TH.open
// ground, ochre accent, staggered reveal — reusing the shared Shell/Reveal/
// Eyebrow primitives. Deliberately NOT the ceremony's tap-to-advance: this is
// one room with two equal-weight buttons (G1), not a story. No ✕ — a third exit
// would be ambiguous against "Not now" and need its own write path.
//
// Mounting stamps reminder_interstitial_seen_at, so displaying this surface
// consumes the one contextual follow-up. Settings remains available afterward.

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
  // Two equal-weight buttons: "Text me" / "Not now".
  | { kind: 'ask'; error: string | null }
  // An opt-in or skip write is in flight.
  | { kind: 'working' }
  // Signed up — a short acknowledgement before proceeding home.
  | { kind: 'done'; message: string }

export function ReminderInterstitial({
  phoneNumber,
  onProceed,
  preview = false,
}: {
  phoneNumber?: string | null
  // Delivers the player to the `/` exit they originally pressed.
  onProceed: () => void
  // Preview mode (admin/dev route): render the room and drive every state, but
  // never touch the account — no seen-stamp or opt-in. The
  // buttons still advance the local state so the flow can be reviewed.
  preview?: boolean
}) {
  const reduced = usePrefersReducedMotion()
  const th = roomTheme('open')
  const [state, setState] = useState<State>({ kind: 'ask', error: null })

  // In preview mode every write is a no-op that reports success, so the state
  // machine advances exactly as it would live without mutating anything.
  const save = preview
    ? async () => true
    : patchReminders

  // Staggered reveal on mount (CSS transition-delay via Reveal). Under reduced
  // motion, Reveal shows its children immediately with no transition.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    if (preview) return
    void patchReminders({ interstitialSeen: true })
  }, [preview])

  async function skip() {
    setState({ kind: 'working' })
    await save({ interstitialSeen: true })
    onProceed()
  }

  async function optInWithSms() {
    setState({ kind: 'working' })
    const ok = await save({
      smsOptIn: 'opted_in',
      smsConsentSource: 'daily_summary_web_form',
    })
    if (ok) {
      setState({
        kind: 'done',
        message: "You're set. We'll text you when each day's five open.",
      })
      return
    }
    setState({
      kind: 'ask',
      error: "We couldn't turn on text reminders. Try again or choose Not now.",
    })
  }

  const busy = state.kind === 'working'

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
                We&rsquo;ll text you when they open. That&rsquo;s the whole thing &mdash; one
                note a day, and only when there&rsquo;s something new to find out.
              </p>
            </Reveal>

            <Reveal show={shown} delay={reduced ? 0 : 0.24} reduced={reduced}>
              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void optInWithSms()}
                    className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full px-5 text-sm font-semibold uppercase tracking-[0.12em] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
                    style={{ backgroundColor: th.fg, color: th.bg }}
                  >
                    {busy ? 'Turning on…' : 'Text me'}
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
                <SmsReminderDisclosure
                  phoneNumber={phoneNumber}
                  actionLabel="Text me"
                  className="text-xs leading-5"
                />
                {state.kind === 'ask' && state.error ? (
                  <p style={{ fontSize: 13, color: th.fg }} role="alert">
                    {state.error}
                  </p>
                ) : null}
              </div>
            </Reveal>
          </>
        )}
      </Shell>
    </div>
  )
}
