'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'

type FriendshipShape = {
  id: string
  status: string
  viewerIsRequester: boolean
} | null

type ProfileFriendButtonProps = {
  targetUserId: string
  friendship: FriendshipShape
  targetDisplayName: string
}

type Action =
  | 'create'
  | 'accept'
  | 'ignore'
  | 'cancel'
  | 'remove'

export function ProfileFriendButton({
  targetUserId,
  friendship,
  targetDisplayName,
}: ProfileFriendButtonProps) {
  const router = useRouter()
  const [pendingAction, setPendingAction] = useState<Action | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(action: Action, request: () => Promise<Response>) {
    if (pendingAction) return
    setPendingAction(action)
    setError(null)
    try {
      const response = await request()
      if (!response.ok) {
        setError('Something went wrong. Please try again.')
        return
      }
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setPendingAction(null)
    }
  }

  const createRequest = () =>
    run('create', () =>
      fetch('/api/friend-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inviteeUserId: targetUserId }),
      })
    )

  const accept = () => {
    if (!friendship) return
    return run('accept', () =>
      fetch(`/api/friend-requests/${friendship.id}/accept`, { method: 'POST' })
    )
  }

  const ignore = () => {
    if (!friendship) return
    return run('ignore', () =>
      fetch(`/api/friend-requests/${friendship.id}/ignore`, { method: 'POST' })
    )
  }

  const cancel = () => {
    if (!friendship) return
    return run('cancel', () =>
      fetch(`/api/friend-requests/${friendship.id}/cancel`, { method: 'POST' })
    )
  }

  const remove = () => {
    if (!friendship) return
    const confirmed = window.confirm(
      `Remove ${targetDisplayName} from your friends?`
    )
    if (!confirmed) return
    return run('remove', () =>
      fetch(`/api/friend-requests/${friendship.id}/remove`, { method: 'POST' })
    )
  }

  const status = friendship?.status ?? null
  const isPending = status === 'pending'
  const isActive = status === 'active'
  const viewerIsRequester = friendship?.viewerIsRequester ?? false

  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {isActive ? (
          <>
            <Button size="sm" variant="secondary" disabled>
              Friends ✓
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={remove}
              disabled={pendingAction !== null}
            >
              {pendingAction === 'remove' ? 'Removing…' : 'Unfriend'}
            </Button>
          </>
        ) : isPending && viewerIsRequester ? (
          <>
            <Button size="sm" variant="secondary" disabled>
              Request sent
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={cancel}
              disabled={pendingAction !== null}
            >
              {pendingAction === 'cancel' ? 'Cancelling…' : 'Cancel'}
            </Button>
          </>
        ) : isPending && !viewerIsRequester ? (
          <>
            <Button
              size="sm"
              onClick={accept}
              disabled={pendingAction !== null}
            >
              {pendingAction === 'accept' ? 'Joining…' : 'Accept'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={ignore}
              disabled={pendingAction !== null}
            >
              {pendingAction === 'ignore' ? 'Setting aside…' : 'Not now'}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            onClick={createRequest}
            disabled={pendingAction !== null}
          >
            {pendingAction === 'create' ? 'Sending…' : 'Add friend'}
          </Button>
        )}
      </div>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  )
}
