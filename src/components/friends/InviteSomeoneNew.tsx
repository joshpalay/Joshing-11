'use client'

import { useEffect, useState } from 'react'

type InviteTokenResponse = { token: string; url: string }

// Side-by-side: "Send a personal invite" (opens the existing AddFriendInvite
// 3-step modal via the friend-invitations:create-new event) and "Copy invite
// link" (fetches/persists the per-user invite token and copies the URL).
export function InviteSomeoneNew() {
  const [copying, setCopying] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  async function copyInviteLink() {
    if (copying) return
    setCopying(true)
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
      await navigator.clipboard.writeText(body.url)
      setToast('Link copied.')
    } catch {
      setError('Could not copy your invite link.')
    } finally {
      setCopying(false)
    }
  }

  return (
    <section className="bg-card text-card-foreground rounded-2xl border p-4 shadow-sm">
      <h2 className="font-serif text-lg font-semibold">Invite someone new</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        A personal note for someone specific, or a casual link you can share anywhere.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={openPersonalInvite}
          className="btn-primary min-h-11 rounded-full px-4 text-sm"
        >
          Send a personal invite
        </button>
        <button
          type="button"
          onClick={() => void copyInviteLink()}
          disabled={copying}
          className="btn-ghost min-h-11 rounded-full px-4 text-sm"
        >
          {copying ? 'Loading…' : 'Copy invite link'}
        </button>
      </div>
      {error ? <p className="text-destructive mt-2 text-sm">{error}</p> : null}
      {toast ? (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      ) : null}
    </section>
  )
}
