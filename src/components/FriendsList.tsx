'use client';

import { useEffect, useState } from 'react';

type Friend = {
  id: string;
  displayName: string;
};

export default function FriendsList() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/users', { cache: 'no-store', credentials: 'include' })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(body)) {
          throw new Error(body?.message ?? 'Could not load friends.');
        }
        setFriends(body);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : 'Could not load friends.');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Loading friends...</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (friends.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4 text-card-foreground">
        <p className="text-sm text-muted-foreground">No friends yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {friends.map((friend) => (
        <div key={friend.id} className="flex items-center justify-between rounded-lg border bg-card p-4 text-card-foreground">
          <p className="font-medium">{friend.displayName}</p>
          {/*
            // v11.1: Joshing Game creation disabled at FAB level. Re-enable
            // when game creation flow is restored.
          */}
        </div>
      ))}
    </div>
  );
}
