'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Action = 'accept' | 'ignore'

export function FriendRequestActions({ friendshipId }: { friendshipId: string }) {
  const router = useRouter()
  const [pendingAction, setPendingAction] = useState<Action | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(action: Action) {
    if (pendingAction) return

    setPendingAction(action)
    setError(null)

    try {
      const response = await fetch(`/api/friend-requests/${friendshipId}/${action}`, {
        method: 'POST',
      })

      if (!response.ok) {
        setError('Could not update this request.')
        return
      }

      router.refresh()
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
          {pendingAction === 'accept' ? 'Accepting…' : 'Accept'}
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={Boolean(pendingAction)}
          onClick={() => void submit('ignore')}
        >
          {pendingAction === 'ignore' ? 'Ignoring…' : 'Ignore'}
        </button>
      </div>
      {error ? <p className="max-w-40 text-right text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
