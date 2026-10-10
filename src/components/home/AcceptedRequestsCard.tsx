'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import type { AcceptedRequestNotice } from '@/server/db/queries/activity'

export const DISMISS_ACCEPTED_REQUESTS_ENDPOINT = '/api/activities/accepted-requests/dismiss'

// "Chiann said yes!" / "Chiann and Tre said yes!" / "Chiann and 2 others said yes!"
// Exported pure so the copy is unit-testable without a DOM.
export function acceptedRequestsHeadline(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return `${names[0]} said yes!`
  if (names.length === 2) return `${names[0]} and ${names[1]} said yes!`
  const others = names.length - 1
  return `${names[0]} and ${others} others said yes!`
}

export function acceptedRequestsBody(count: number): string {
  return count === 1 ? 'You two are friends now.' : "You're all friends now."
}

// Single accepter → their profile; several → the Friends page.
export function acceptedRequestsLink(friends: AcceptedRequestNotice['friends']): { href: string; label: string } {
  if (friends.length === 1) {
    return { href: `/users/${friends[0].userId}`, label: `See ${friends[0].name}'s profile` }
  }
  return { href: '/friends', label: 'See your friends' }
}

export default function AcceptedRequestsCard({ notice }: { notice: AcceptedRequestNotice }) {
  const router = useRouter()
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || notice.friends.length === 0) return null

  // Fire-and-forget: hide immediately; if the write fails the card simply
  // comes back on the next visit, which is the honest fallback.
  function markSeen() {
    setDismissed(true)
    void fetch(DISMISS_ACCEPTED_REQUESTS_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activityIds: notice.activityIds }),
    })
      .then(() => {
        router.refresh()
        window.dispatchEvent(new Event('nav:refresh'))
      })
      .catch(() => {})
  }

  const names = notice.friends.map((friend) => friend.name)
  const link = acceptedRequestsLink(notice.friends)

  return (
    <section aria-labelledby="home-accepted-requests-heading">
      <article className="rounded-[var(--radius-card)] border border-[var(--brand-border)] bg-[var(--feed-card-elevated)] p-4 shadow-[var(--shadow-card)]">
        <h2 id="home-accepted-requests-heading" className="font-semibold text-[var(--brand-ink)]">
          {acceptedRequestsHeadline(names)}
        </h2>
        <p className="mt-1 text-sm text-[var(--brand-ink-400)]">{acceptedRequestsBody(names.length)}</p>

        <div className="mt-4 flex items-center gap-3">
          {/* Opening the profile counts as seeing the news too. */}
          <Link href={link.href} className="btn-primary flex-1" onClick={markSeen}>
            {link.label}
          </Link>
          {/* Quiet outline, like Decline on "Wants to connect": set apart from the
              filled primary by shape and weight, not color alone. */}
          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-xs)] border border-[var(--brand-border)] bg-transparent px-4 py-2 text-sm font-medium text-[var(--brand-ink)] transition hover:bg-[var(--brand-card)] focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            onClick={markSeen}
          >
            Got it
          </button>
        </div>
      </article>
    </section>
  )
}
