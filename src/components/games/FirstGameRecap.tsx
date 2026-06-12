'use client';

/**
 * First-Game Recap (B-FirstGameRecap-1) — cinematic overlay.
 *
 * Reuses the same story-style shell as the Daily Five first-session recap, but
 * is scoped to the user's first completed Joshing game and persists a separate
 * seen-signal.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

import type { FirstGameRecapBeat2, FirstGameRecapView } from '@/server/games/first-game-recap';

type BeatNode = { key: string; content: ReactNode };

function Beat1({ firstName, gameTitle }: { firstName: string; gameTitle: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm tracking-[0.16em] uppercase" style={{ color: 'var(--text-muted)' }}>
        First game complete
      </p>
      <h1 className="mt-4 font-serif text-5xl font-semibold tracking-normal sm:text-7xl">
        Nice start{firstName ? `, ${firstName}` : ''}.
      </h1>
      <p
        className="mx-auto mt-8 max-w-2xl text-lg leading-8 sm:text-xl"
        style={{ color: 'var(--warm-50)' }}
      >
        You finished {gameTitle}.
      </p>
    </div>
  );
}

function Beat2({ beat }: { beat: FirstGameRecapBeat2 }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm tracking-[0.16em] uppercase" style={{ color: 'var(--text-muted)' }}>
        This game touched
      </p>
      <h1 className="mt-4 font-serif text-4xl leading-tight font-semibold tracking-normal sm:text-6xl">
        {beat.touchedDomains.join(' · ')}
      </h1>
      <p
        className="mx-auto mt-8 max-w-2xl text-lg leading-8 sm:text-xl"
        style={{ color: 'var(--warm-50)' }}
      >
        Your knowledge map has new marks.
      </p>
      {beat.offTheGroundDomain ? (
        <p
          className="mx-auto mt-3 max-w-2xl text-lg leading-8 sm:text-xl"
          style={{ color: 'var(--warm-50)' }}
        >
          {beat.offTheGroundDomain} is already off the ground.
        </p>
      ) : null}
      {beat.newTerritoryDomain ? (
        <p
          className="mx-auto mt-3 max-w-2xl text-lg leading-8 sm:text-xl"
          style={{ color: 'var(--text-muted)' }}
        >
          {beat.newTerritoryDomain} is new territory &mdash; that&rsquo;s where the map grows.
        </p>
      ) : null}
    </div>
  );
}

function WeeklyOverviewBeat() {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm tracking-[0.16em] uppercase" style={{ color: 'var(--text-muted)' }}>
        What happens next
      </p>
      <h1 className="mt-4 font-serif text-4xl leading-tight font-semibold tracking-normal sm:text-6xl">
        Every week, you&rsquo;ll get the wider view.
      </h1>
      <p
        className="mx-auto mt-8 max-w-2xl text-lg leading-8 sm:text-xl"
        style={{ color: 'var(--warm-50)' }}
      >
        We&rsquo;ll show your progress, how you helped your friends, and how they helped you.
      </p>
    </div>
  );
}

export function FirstGameRecap({
  recap,
  onDismiss,
}: {
  recap: FirstGameRecapView;
  onDismiss: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);

  // Persist the seen-signal the moment the recap is shown — re-entry, refresh,
  // and later game summaries must never re-trigger it. Fire-and-forget.
  useEffect(() => {
    fetch('/api/joshing-games/first-game-recap/seen', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => undefined);
  }, []);

  const beats = useMemo<BeatNode[]>(() => {
    const nodes: BeatNode[] = [
      {
        key: 'beat1',
        content: <Beat1 firstName={recap.firstName} gameTitle={recap.gameTitle} />,
      },
    ];
    if (recap.beat2) {
      nodes.push({ key: 'beat2', content: <Beat2 beat={recap.beat2} /> });
    }
    nodes.push({ key: 'weekly', content: <WeeklyOverviewBeat /> });
    return nodes;
  }, [recap]);

  const isEnd = currentIndex >= beats.length;

  function advance() {
    setCurrentIndex((value) => Math.min(value + 1, beats.length));
  }
  function goBack() {
    setCurrentIndex((value) => Math.max(value - 1, 0));
  }
  function handleTap(event: React.MouseEvent<HTMLElement>) {
    const width = event.currentTarget.clientWidth;
    if (width > 0 && event.clientX < width * 0.3) {
      goBack();
    } else {
      advance();
    }
  }

  return (
    <main
      className="fixed inset-0 z-50 grid cursor-pointer place-items-center overflow-hidden px-6 py-16"
      style={{ background: 'var(--brand-ink)', color: 'var(--warm-50)' }}
      onClick={handleTap}
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 20%, color-mix(in srgb, var(--warm-50) 12%, transparent), transparent 36%), linear-gradient(180deg, var(--brand-ink) 0%, color-mix(in srgb, var(--brand-ink) 85%, black) 100%)',
        }}
      />

      <button
        type="button"
        aria-label="Close"
        className="absolute top-[max(1.25rem,env(safe-area-inset-top))] right-5 z-20 grid size-11 place-items-center rounded-full transition"
        style={{ color: 'var(--warm-100)' }}
        onClick={(event) => {
          event.stopPropagation();
          onDismiss();
        }}
      >
        <X className="size-7" />
      </button>

      <div key={currentIndex} className="relative z-10 w-full animate-[fadeIn_0.4s_ease]">
        {isEnd ? (
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="font-serif text-4xl leading-tight font-semibold tracking-normal sm:text-6xl">
              Your full game summary is ready.
            </h1>
            <div className="mt-10 flex justify-center">
              <button
                type="button"
                className="inline-flex h-12 items-center justify-center rounded-md px-8 text-sm font-medium transition"
                style={{ background: 'var(--warm-50)', color: 'var(--brand-ink)' }}
                onClick={(event) => {
                  event.stopPropagation();
                  onDismiss();
                }}
              >
                View game summary →
              </button>
            </div>
          </div>
        ) : (
          beats[currentIndex]!.content
        )}
      </div>

      {!isEnd && beats.length > 0 ? (
        <div
          className="absolute right-0 left-0 z-10 flex justify-center gap-2"
          style={{ bottom: 'max(1.75rem, env(safe-area-inset-bottom))' }}
        >
          {beats.map((beat, index) => (
            <span
              key={beat.key}
              className={index === currentIndex ? 'h-2 w-8 rounded-full' : 'h-2 w-2 rounded-full'}
              style={{
                background: index === currentIndex ? 'var(--warm-50)' : 'var(--text-muted)',
              }}
            />
          ))}
        </div>
      ) : null}

      <style jsx global>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
      `}</style>
    </main>
  );
}
