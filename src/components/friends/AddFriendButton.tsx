'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { AddFriendRequestModal } from '@/components/friends/AddFriendRequestModal'
import type { RelationshipResult } from '@/server/db/queries/friend-requests'

type Props = {
  targetUserId: string
  targetDisplayName: string
  relationship: RelationshipResult
  // Called after a successful add / cancel / accept / ignore / remove so
  // the parent can refresh its data (router.refresh() or refetch).
  onChange?: () => void
  // If true, confirm Unfriend via window.confirm (the existing
  // ProfileFriendButton behavior we want to preserve when this component
  // is used on profile pages). Defaults to true.
  confirmUnfriend?: boolean
}

type Action = 'cancel' | 'accept' | 'ignore' | 'remove'

export function AddFriendButton({
  targetUserId,
  targetDisplayName,
  relationship,
  onChange,
  confirmUnfriend = true,
}: Props) {
  const [pendingAction, setPendingAction] = useState<Action | 'open' | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 1800)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function runAction(action: Action, friendshipId: string, successToast: string) {
    if (pendingAction) return
    setPendingAction(action)
    setError(null)
    try {
      const response = await fetch(`/api/friend-requests/${friendshipId}/${action}`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null
        setError(body?.message ?? 'Could not update this request.')
        return
      }
      setToast(successToast)
      onChange?.()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setPendingAction(null)
    }
  }

  function handleAddClick() {
    setError(null)
    setModalOpen(true)
  }

  function handleSent() {
    setToast('Sent.')
    onChange?.()
  }

  function handleCancel() {
    if (!relationship.friendshipId) return
    void runAction('cancel', relationship.friendshipId, 'Cancelled.')
  }

  function handleAccept() {
    if (!relationship.friendshipId) return
    void runAction('accept', relationship.friendshipId, 'Friends.')
  }

  function handleIgnore() {
    if (!relationship.friendshipId) return
    void runAction('ignore', relationship.friendshipId, 'Set aside.')
  }

  function handleRemove() {
    if (!relationship.friendshipId) return
    if (confirmUnfriend) {
      const confirmed = window.confirm(`Remove ${targetDisplayName} from your friends?`)
      if (!confirmed) return
    }
    void runAction('remove', relationship.friendshipId, 'Removed.')
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {relationship.state === 'none' ? (
          <Button
            type="button"
            size="sm"
            onClick={handleAddClick}
            disabled={pendingAction !== null}
          >
            Add friend
          </Button>
        ) : null}

        {relationship.state === 'pending_outbound' ? (
          <>
            <Button type="button" size="sm" variant="secondary" disabled>
              Request sent
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleCancel}
              disabled={pendingAction !== null}
            >
              {pendingAction === 'cancel' ? 'Cancelling…' : 'Cancel'}
            </Button>
          </>
        ) : null}

        {relationship.state === 'pending_inbound' ? (
          <>
            <Button
              type="button"
              size="sm"
              onClick={handleAccept}
              disabled={pendingAction !== null}
            >
              {pendingAction === 'accept' ? 'Joining…' : 'Accept'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleIgnore}
              disabled={pendingAction !== null}
            >
              {pendingAction === 'ignore' ? 'Setting aside…' : 'Not now'}
            </Button>
          </>
        ) : null}

        {relationship.state === 'friends' ? (
          <>
            <Button type="button" size="sm" variant="secondary" disabled>
              Friends ✓
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleRemove}
              disabled={pendingAction !== null}
            >
              {pendingAction === 'remove' ? 'Removing…' : 'Unfriend'}
            </Button>
          </>
        ) : null}

        {relationship.state === 'recently_sent' ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled
            title="You sent a request to this person in the last 30 days."
          >
            Recently sent
          </Button>
        ) : null}
      </div>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}

      {toast ? (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      ) : null}

      {modalOpen ? (
        <AddFriendRequestModal
          onClose={() => setModalOpen(false)}
          targetUserId={targetUserId}
          targetDisplayName={targetDisplayName}
          onSent={handleSent}
        />
      ) : null}
    </div>
  )
}
