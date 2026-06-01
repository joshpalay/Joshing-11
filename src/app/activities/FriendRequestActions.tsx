'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Action = 'accept' | 'ignore';

export function FriendRequestActions({ friendshipId }: { friendshipId: string }) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: Action) {
    if (pendingAction) return;

    setPendingAction(action);
    setError(null);

    try {
      const response = await fetch(`/api/friend-requests/${friendshipId}/${action}`, {
        method: 'POST',
      });

      if (!response.ok) {
        setError('Could not update this note.');
        return;
      }

      router.refresh();
    } finally {
      setPendingAction(null);
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
      {error ? <p className="text-destructive max-w-40 text-right text-xs">{error}</p> : null}
    </div>
  );
}
