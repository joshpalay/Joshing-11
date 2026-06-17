'use client'

import { useEffect, useState } from 'react'

import { AddFriendRequestModal } from '@/components/friends/AddFriendRequestModal'
import type { RelationshipResult } from '@/server/db/queries/friend-requests'

type Props = {
  targetUserId: string
  targetDisplayName: string
  relationship: RelationshipResult
  // Called after a successful add / cancel / accept / ignore / remove so
  // the parent can refresh its data (router.refresh() or refetch).
  onChange?: () => void
  // If true, Unfriend asks for inline confirmation (a Remove/Keep step in the
  // app's own button language) before removing. Defaults to true.
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
  const [confirmingRemove, setConfirmingRemove] = useState(false)

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
    void runAction('accept', relationship.friendshipId, 'Approved.')
  }

  function handleIgnore() {
    if (!relationship.friendshipId) return
    void runAction('ignore', relationship.friendshipId, 'Set aside.')
  }

  const removeCopy =
    relationship.state === 'friends'
      ? {
          action: 'Unfriend',
          confirming: 'Unfriending…',
          prompt: `Unfriend ${targetDisplayName}?`,
          toast: 'Unfriended.',
        }
      : {
          action: 'Unfollow',
          confirming: 'Unfollowing…',
          prompt: `Unfollow ${targetDisplayName}?`,
          toast: 'Unfollowed.',
        }

  function handleRemove() {
    if (!relationship.friendshipId) return
    if (confirmUnfriend) {
      // Swap the remove button for an inline confirmation rather than punching
      // out to native window.confirm chrome.
      setConfirmingRemove(true)
      return
    }
    void runAction('remove', relationship.friendshipId, removeCopy.toast)
  }

  function confirmRemove() {
    if (!relationship.friendshipId) return
    setConfirmingRemove(false)
    void runAction('remove', relationship.friendshipId, removeCopy.toast)
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {relationship.state === 'none' ? (
          <button
            type="button"
            className="btn-primary"
            onClick={handleAddClick}
            disabled={pendingAction !== null}
          >
            Follow
          </button>
        ) : null}

        {relationship.state === 'follows_you' ? (
          <button
            type="button"
            className="btn-primary"
            onClick={handleAddClick}
            disabled={pendingAction !== null}
          >
            Follow back
          </button>
        ) : null}

        {relationship.state === 'pending_outbound' ? (
          <>
            <button type="button" className="btn-ghost" disabled>
              Requested
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={handleCancel}
              disabled={pendingAction !== null}
            >
              {pendingAction === 'cancel' ? 'Cancelling…' : 'Cancel'}
            </button>
          </>
        ) : null}

        {relationship.state === 'pending_inbound' ? (
          <>
            <button
              type="button"
              className="btn-primary"
              onClick={handleAccept}
              disabled={pendingAction !== null}
            >
              {pendingAction === 'accept' ? 'Approving…' : 'Approve'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={handleIgnore}
              disabled={pendingAction !== null}
            >
              {pendingAction === 'ignore' ? 'Setting aside…' : 'Not now'}
            </button>
          </>
        ) : null}

        {relationship.state === 'friends' || relationship.state === 'following' ? (
          confirmingRemove ? (
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label={removeCopy.prompt}
            >
              <span className="text-sm text-foreground">{removeCopy.prompt}</span>
              <button
                type="button"
                className="btn-danger"
                onClick={confirmRemove}
                disabled={pendingAction !== null}
              >
                {pendingAction === 'remove' ? removeCopy.confirming : removeCopy.action}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setConfirmingRemove(false)}
                disabled={pendingAction !== null}
              >
                Keep
              </button>
            </div>
          ) : (
            <>
              <button type="button" className="btn-ghost" disabled>
                {relationship.state === 'friends' ? 'Friends ✓' : 'Following ✓'}
              </button>
              {/* Demoted to a quiet text link so the destructive action recedes
                  behind the "Friends ✓" status pill rather than reading as a
                  co-equal CTA. */}
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground self-center text-xs underline underline-offset-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45"
                onClick={handleRemove}
                disabled={pendingAction !== null}
              >
                {removeCopy.action}
              </button>
            </>
          )
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
