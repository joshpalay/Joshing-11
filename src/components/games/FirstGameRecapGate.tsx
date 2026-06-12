'use client';

import { useEffect, useState } from 'react';

import { FirstGameRecap } from '@/components/games/FirstGameRecap';
import type { FirstGameRecapView } from '@/server/games/first-game-recap';

export function FirstGameRecapGate({ gameId }: { gameId: string }) {
  const [recap, setRecap] = useState<FirstGameRecapView | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/joshing-games/first-game-recap?gameId=${encodeURIComponent(gameId)}`, {
      credentials: 'include',
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) return;
        const body = await response.json().catch(() => null);
        if (!cancelled && body?.recap) {
          setRecap(body.recap as FirstGameRecapView);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  if (!recap) return null;

  return <FirstGameRecap recap={recap} onDismiss={() => setRecap(null)} />;
}
