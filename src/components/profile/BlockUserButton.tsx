'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  targetUserId: string
  targetDisplayName: string
}

// Secondary, overflow-style control -- deliberately not styled like the
// primary friend-request button above it. Confirms before landing (Read
// First / spec: "A block is a hard boundary" -- it removes any existing
// connection) and never distinguishes success from any other outcome in its
// copy; the target's profile simply becomes unreachable afterward (see
// getFriendPortraitData's isBlocked short-circuit).
export function BlockUserButton({ targetUserId, targetDisplayName }: Props) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleBlock() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(targetUserId)}/block`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null
        setError(body?.message ?? 'Could not block this person.')
        return
      }
      router.push('/friends')
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setPending(false)
    }
  }

  if (confirming) {
    return (
      <div className="mt-3 text-sm">
        <p className="text-muted-foreground">
          Block {targetDisplayName}? This removes any existing connection between you. They
          won&apos;t be told.
        </p>
        <div className="mt-2 flex gap-3">
          <button
            type="button"
            onClick={() => void handleBlock()}
            disabled={pending}
            className="text-destructive font-medium underline-offset-4 hover:underline"
          >
            {pending ? 'Blocking…' : 'Block'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="text-muted-foreground underline-offset-4 hover:underline"
          >
            Cancel
          </button>
        </div>
        {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="text-muted-foreground/70 hover:text-muted-foreground mt-3 text-xs underline-offset-4 hover:underline"
    >
      Block
    </button>
  )
}
