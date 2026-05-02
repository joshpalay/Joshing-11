'use client';

import { useState } from 'react';

export function ReactionGotItButton({ reactionId, replied }: { reactionId: string; replied: boolean }) {
  const [acknowledged, setAcknowledged] = useState(replied);
  const [pending, setPending] = useState(false);

  async function markReplied() {
    if (acknowledged || pending) return;
    setPending(true);
    try {
      const response = await fetch(`/api/reactions/${reactionId}/reply`, {
        method: 'POST',
        credentials: 'include',
      });
      if (response.ok) setAcknowledged(true);
    } finally {
      setPending(false);
    }
  }

  if (acknowledged) {
    return <span className="text-xs text-muted-foreground">Acknowledged</span>;
  }

  return (
    <button
      type="button"
      className="inline-flex h-9 items-center rounded-md border px-3 text-sm"
      onClick={() => void markReplied()}
      disabled={pending}
    >
      👍 Got it
    </button>
  );
}
