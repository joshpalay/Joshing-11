'use client';

import { useEffect, useState } from 'react';

import { AddFriendRequestModal } from '@/components/friends/AddFriendRequestModal';
import type { RelationshipResult } from '@/server/db/queries/friend-requests';

type Props = {
  targetUserId: string;
  targetDisplayName: string;
  relationship: RelationshipResult;
  // Called after a successful add / cancel / accept / ignore / remove so
  // the parent can refresh its data (router.refresh() or refetch).
  onChange?: () => void;
  // If true, Unfriend asks for inline confirmation (a Remove/Keep step in the
  // app's own button language) before removing. Defaults to true.
  confirmUnfriend?: boolean;
};

type Action = 'cancel' | 'accept' | 'ignore' | 'remove';

export function AddFriendButton({
  targetUserId,
  targetDisplayName,
  relationship,
  onChange,
  confirmUnfriend = true,
}: Props) {
  const [pendingAction, setPendingAction] = useState<Action | 'open' | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function runAction(action: Action, friendshipId: string, successToast: string) {
    if (pendingAction) return;
    setPendingAction(action);
    setError(null);
    try {
      const response = await fetch(`/api/friend-requests/${friendshipId}/${action}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? 'Could not update this request.');
        return;
      }
      setToast(successToast);
      onChange?.();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setPendingAction(null);
    }
  }

  function handleAddClick() {
    setError(null);
    setModalOpen(true);
  }

  function handleSent() {
    setToast('Sent.');
    onChange?.();
  }

  function handleCancel() {
    if (!relationship.friendshipId) return;
    void runAction('cancel', relationship.friendshipId, 'Cancelled.');
  }

  function handleAccept() {
    if (!relationship.friendshipId) return;
    void runAction('accept', relationship.friendshipId, 'Friends.');
  }

  function handleIgnore() {
    if (!relationship.friendshipId) return;
    void runAction('ignore', relationship.friendshipId, 'Set aside.');
  }

  function handleRemove() {
    if (!relationship.friendshipId) return;
    if (confirmUnfriend) {
      // Swap the Unfriend button for an inline Remove/Keep confirmation rather
      // than punching out to native window.confirm chrome.
      setConfirmingRemove(true);
      return;
    }
    void runAction('remove', relationship.friendshipId, 'Removed.');
  }

  function confirmRemove() {
    if (!relationship.friendshipId) return;
    setConfirmingRemove(false);
    void runAction('remove', relationship.friendshipId, 'Removed.');
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
            Add friend
          </button>
        ) : null}

        {relationship.state === 'pending_outbound' ? (
          <>
            <button type="button" className="btn-ghost" disabled>
              Request sent
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
              {pendingAction === 'accept' ? 'Joining…' : 'Accept'}
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

        {relationship.state === 'friends' ? (
          confirmingRemove ? (
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label={`Remove ${targetDisplayName} from your friends?`}
            >
              <span className="text-foreground text-sm">Remove {targetDisplayName}?</span>
              <button
                type="button"
                className="btn-danger"
                onClick={confirmRemove}
                disabled={pendingAction !== null}
              >
                {pendingAction === 'remove' ? 'Removing…' : 'Remove'}
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
                Friends ✓
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={handleRemove}
                disabled={pendingAction !== null}
              >
                Unfriend
              </button>
            </>
          )
        ) : null}

        {relationship.state === 'recently_sent' ? (
          <button
            type="button"
            className="btn-ghost"
            disabled
            title="You sent a request to this person in the last 30 days."
          >
            Recently sent
          </button>
        ) : null}
      </div>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}

      {toast ? (
        <div className="bg-foreground text-background fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm shadow-lg">
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
  );
}
