'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

// Shown on Friends right after a block (BlockUserButton lands here with
// ?blocked=1). Blocking used to finish silently — the person was just missing
// from the list — so the blocker couldn't tell it had worked (QA 2026-10-17).
// The param carries no name or id, and it's stripped from the address on
// arrival so a reload or a shared link doesn't repeat the message.
export function BlockedNotice() {
  const searchParams = useSearchParams()
  // Read once: the effect below strips the param, and the notice stays.
  const [show] = useState(() => searchParams.get('blocked') === '1')

  useEffect(() => {
    if (searchParams.get('blocked') !== '1') return
    const url = new URL(window.location.href)
    url.searchParams.delete('blocked')
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  }, [searchParams])

  if (!show) return null
  return (
    <p
      role="status"
      className="mb-4 rounded-[var(--radius-card)] border border-[var(--border-warm)] bg-[var(--brand-card)] px-4 py-3 text-sm leading-6 text-[var(--ink)]"
    >
      Blocked. They can&apos;t see your profile or find you, and they weren&apos;t told. You can
      undo this any time in{' '}
      <Link href="/blocked" className="font-medium text-[var(--brand-link)] underline underline-offset-4">
        Blocked people
      </Link>
      .
    </p>
  )
}
