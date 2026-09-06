'use client'

import { useEffect, useState } from 'react'

// The onboarding reminder-ask's confirmation, decoupled from whether the
// crafting screen ever shows. It used to live inside LoadingScreen's
// generating-only branch, so a fast build (generation already done by the
// time the player lands here) meant the confirmation never rendered at all.
// This renders unconditionally on first mount instead, then self-dismisses —
// present whether the player is still watching the crafting screen or
// already looking at their first question.
export function ReminderConfirmedToast({ show }: { show: boolean }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!show) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to the parent's own one-time URL-param read, not derived render state.
    setVisible(true)
    const timer = window.setTimeout(() => setVisible(false), 1800)
    return () => window.clearTimeout(timer)
  }, [show])

  if (!visible) return null
  return (
    <div className="fixed bottom-24 left-1/2 z-[var(--z-toast)] -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg md:bottom-8">
      You&rsquo;re set &mdash; we&rsquo;ll text you when each day&rsquo;s five open.
    </div>
  )
}
