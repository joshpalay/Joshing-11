'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Action = 'accept' | 'ignore'

export function FriendRequestActions({
  friendshipId,
}: {
  friendshipId: string
}) {
  const router = useRouter()
  const [pendingAction, setPendingAction] = useState<Action | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(action: Action) {
    if (pendingAction) return

    setPendingAction(action)
    setError(null)

    try {
      const response = await fetch(
        `/api/friend-requests/${friendshipId}/${action}`,
        {
          method: 'POST',
        }
      )

      // A 404 means this request is no longer pending — it was already accepted
      // or declined elsewhere (the "Wants to connect" card, the /friends hub, or
      // another tab) and this Recent Activity row is just a stale duplicate. The
      // end state the tap was reaching for already holds, so this is NOT an
      // error: refresh so the now-settled card clears, rather than stranding a
      // dead button behind a confusing message.
      if (response.ok || response.status === 404) {
        router.refresh()
        return
      }

      setError('Could not update this request.')
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={Boolean(pendingAction)}
          onClick={() => void submit('accept')}
        >
          {pendingAction === 'accept' ? 'Joining…' : 'Accept'}
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={Boolean(pendingAction)}
          onClick={() => void submit('ignore')}
        >
          {pendingAction === 'ignore' ? 'Setting aside…' : 'Not now'}
        </button>
      </div>
      {error ? (
        <p className="text-destructive max-w-40 text-right text-xs">{error}</p>
      ) : null}
    </div>
  )
}
