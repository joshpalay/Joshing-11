'use client';

/**
 * First-Game Panel (B-FirstGameRecap-1, reworked).
 *
 * Replaces the old full-screen "first game" cinematic. For a user's first
 * completed Joshing game we now show a quiet inline panel at the top of the
 * game summary instead of taking over the screen: a short "nice going", the
 * reminder opt-in (reused from the Daily Five summary), and a link to change
 * which questions you get. The summary itself is the reward.
 *
 * The eligibility fetch + seen-signal plumbing is unchanged from the cinematic:
 * the panel only renders for the first completed game, and the seen-signal is
 * persisted the moment it mounts so refresh / re-entry never re-trigger it.
 */

import { useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';

import { RoundReminderCard } from '@/app/daily/summary/RoundReminderCard';
import type { FirstGameRecapView } from '@/server/games/first-game-recap';

const monoStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.62rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
};

export function FirstGamePanel({ gameId }: { gameId: string }) {
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

  // Persist the seen-signal as soon as the panel shows — re-entry, refresh, and
  // later game summaries must never re-trigger it. Fire-and-forget.
  useEffect(() => {
    if (!recap) return;
    fetch('/api/joshing-games/first-game-recap/seen', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => undefined);
  }, [recap]);

  if (!recap) return null;

  return (
    <>
      <section className="card mt-5 px-5 py-5">
        <p style={monoStyle}>First game complete</p>
        <h2 className="mt-2 font-serif text-2xl leading-tight text-[var(--brand-ink)]">
          Nice going{recap.firstName ? `, ${recap.firstName}` : ''}.
        </h2>
        <p className="mt-2 text-sm leading-6 text-foreground">
          New questions come every day. Want different ones?{' '}
          <Link href="/daily/setup" className="underline underline-offset-2">
            Set your topics here
          </Link>
          .
        </p>
      </section>

      <RoundReminderCard
        title="Want a reminder when new questions land?"
        description="One message a day, max. You can turn it off any time."
      />
    </>
  );
}
