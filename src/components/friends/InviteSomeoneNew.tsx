'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type InviteTokenResponse = {
  token: string
  url: string
  userId?: string
  topicCount?: number
}

const SHARE_TEXT = "I'm playing Joshing — come be my friend."

// Side-by-side: "Share invite link" (navigator.share, falling back to copy)
// and "Text a personal invite" (opens the existing AddFriendInvite 3-step
// modal via the friend-invitations:create-new event). The link is the
// primary action — most people should never need the phone-first flow.
export function InviteSomeoneNew() {
  const [sharing, setSharing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ownUserId, setOwnUserId] = useState<string | null>(null)
  const [topicCount, setTopicCount] = useState<number | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 1800)
    return () => window.clearTimeout(timer)
  }, [toast])

  function openPersonalInvite() {
    window.dispatchEvent(
      new CustomEvent('friend-invitations:create-new', { detail: {} }),
    )
  }

  async function shareInviteLink() {
    if (sharing) return
    setSharing(true)
    setError(null)
    try {
      const response = await fetch('/api/account/invite-token', {
        credentials: 'include',
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null
        setError(body?.message ?? 'Could not fetch your invite link.')
        return
      }
      const body = (await response.json().catch(() => null)) as InviteTokenResponse | null
      if (!body?.url) {
        setError('Could not build your invite link.')
        return
      }
      setOwnUserId(body.userId ?? null)
      setTopicCount(typeof body.topicCount === 'number' ? body.topicCount : null)

      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ text: SHARE_TEXT, url: body.url })
          return
        } catch (shareError) {
          // The user closing the share sheet is not a failure — leave it
          // silent rather than falling back to a surprise clipboard copy.
          if (shareError instanceof Error && shareError.name === 'AbortError') return
          // Any other share failure (unsupported target, etc.) falls through
          // to the clipboard path below.
        }
      }
      await navigator.clipboard.writeText(body.url)
      setToast('Link copied.')
    } catch {
      setError('Could not share your invite link.')
    } finally {
      setSharing(false)
    }
  }

  return (
    <section className="bg-card text-card-foreground rounded-[var(--radius-card)] border p-4 shadow-[var(--shadow-card)]">
      <h2 className="font-serif text-lg font-semibold">Invite someone new</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        Share a link you can send anywhere, or text a personal note to someone&rsquo;s phone.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => void shareInviteLink()}
          disabled={sharing}
          className="btn-primary px-4"
        >
          {sharing ? 'Loading…' : 'Share invite link'}
        </button>
        <button
          type="button"
          onClick={openPersonalInvite}
          className="btn-ghost px-4"
        >
          Text a personal invite
        </button>
      </div>
      {topicCount !== null ? (
        <p className="text-muted-foreground mt-2 text-xs">
          Your link shows {topicCount} {topicCount === 1 ? 'topic' : 'topics'}.{' '}
          {ownUserId ? (
            <Link href={`/users/${ownUserId}`} className="underline underline-offset-2">
              Edit
            </Link>
          ) : null}
        </p>
      ) : null}
      {error ? <p className="text-destructive mt-2 text-sm">{error}</p> : null}
      {toast ? (
        <div className="fixed bottom-24 left-1/2 z-[var(--z-toast)] -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      ) : null}
    </section>
  )
}
