'use client';

/**
 * First-Session Recap (B-FirstRecap-1) — cinematic overlay.
 *
 * Reuses the biweekly ceremony's cinematic SHELL register (full-screen beats,
 * tap-to-advance with a left-third "back" zone, fade transitions, progress
 * dots) — but NONE of its beat-computation code. Beats are assembled from the
 * server-computed FirstSessionRecapView with the same null-omit discipline the
 * ceremony uses: a beat with no content is simply not pushed.
 *
 * Fires once: the seen-signal is persisted as soon as the overlay mounts, so
 * re-entry/refresh/catch-up never re-trigger it.
 */

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

import { formatNextResetDayTimeLocal } from '@/lib/games/timezone';

// useSyncExternalStore inputs for the client-only reset-time label, mirroring
// the daily summary page: null during SSR keeps hydration stable, and the
// snapshot is read on the client without a setState-in-effect. The label is
// day-aware ("today at 1 PM" / "tomorrow at 1 PM") so the close copy stays
// correct when the next reset falls later on the current local day.
const subscribeNoop = () => () => {};
const getResetTimeSnapshot = () => formatNextResetDayTimeLocal();
const getResetTimeServerSnapshot = (): string | null => null;
import type {
  FirstSessionRecapBeat2,
  FirstSessionRecapBeat3,
  FirstSessionRecapView,
} from '@/server/daily/first-session-recap';

type BeatNode = { key: string; content: ReactNode };

function Beat1({ firstName }: { firstName: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h1 className="font-serif text-5xl font-semibold tracking-normal sm:text-7xl">
        Nice start{firstName ? `, ${firstName}` : ''}.
      </h1>
      <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
        You answered your first five.
      </p>
    </div>
  );
}

function Beat2({
  beat,
  onOpenMap,
}: {
  beat: FirstSessionRecapBeat2;
  onOpenMap: () => void;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm uppercase tracking-[0.16em] text-stone-400">
        Today&rsquo;s five touched
      </p>
      <h1 className="mt-4 font-serif text-4xl font-semibold leading-tight tracking-normal sm:text-6xl">
        {beat.touchedDomains.join(' · ')}
      </h1>
      <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
        Your knowledge map has its first marks.
      </p>
      {beat.offTheGroundDomain ? (
        <p className="mx-auto mt-3 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
          {beat.offTheGroundDomain} is already off the ground.
        </p>
      ) : null}
      {beat.newTerritoryDomain ? (
        <p className="mx-auto mt-3 max-w-2xl text-lg leading-8 text-stone-300 sm:text-xl">
          {beat.newTerritoryDomain} is new territory &mdash; that&rsquo;s where the map grows.
        </p>
      ) : null}
      <button
        type="button"
        className="mt-10 inline-flex h-12 items-center justify-center rounded-md bg-stone-100 px-6 text-sm font-medium text-stone-950 transition hover:bg-white"
        onClick={(event) => {
          event.stopPropagation();
          onOpenMap();
        }}
      >
        Open your knowledge map →
      </button>
    </div>
  );
}

function Beat3({
  beat,
  onInvite,
}: {
  beat: FirstSessionRecapBeat3;
  onInvite: () => void;
}) {
  if (beat.kind === 'no_inviter') {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="font-serif text-4xl font-semibold leading-tight tracking-normal sm:text-6xl">
          Invite someone whose questions you&rsquo;d want to see.
        </h1>
        <button
          type="button"
          className="mt-10 inline-flex h-12 items-center justify-center rounded-md bg-stone-100 px-6 text-sm font-medium text-stone-950 transition hover:bg-white"
          onClick={(event) => {
            event.stopPropagation();
            onInvite();
          }}
        >
          Invite a friend →
        </button>
      </div>
    );
  }

  const { inviterName } = beat;
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h1 className="font-serif text-4xl font-semibold leading-tight tracking-normal sm:text-6xl">
        {inviterName} invited you here.
      </h1>
      {beat.kind === 'inviter_present' ? (
        <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
          {inviterName}&rsquo;s been playing &mdash; their last few questions are
          already waiting for you on your home screen. You&rsquo;ll start to see
          where your maps overlap.
        </p>
      ) : (
        <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
          As {inviterName} plays, their questions show up on your home screen, and
          you&rsquo;ll see where your maps overlap.
        </p>
      )}
    </div>
  );
}

export function FirstSessionRecap({
  recap,
  onDismiss,
}: {
  recap: FirstSessionRecapView;
  onDismiss: () => void;
}) {
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);
  // Client-only day-aware reset label for the close copy; null during SSR.
  const resetDayTime = useSyncExternalStore(
    subscribeNoop,
    getResetTimeSnapshot,
    getResetTimeServerSnapshot,
  );

  // Persist the seen-signal the moment the recap is shown — re-entry, refresh,
  // and replaying catch-up must never re-trigger it. Fire-and-forget.
  useEffect(() => {
    fetch('/api/daily/first-session-recap/seen', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => undefined);
  }, []);

  const openMap = () => {
    onDismiss();
    router.push('/knowledge');
  };
  const invite = () => {
    onDismiss();
    router.push('/friends');
  };

  const beats = useMemo<BeatNode[]>(() => {
    const nodes: BeatNode[] = [];
    // Beat 1 always renders.
    nodes.push({ key: 'beat1', content: <Beat1 firstName={recap.firstName} /> });
    // Beat 2 omitted only in the defensive empty-session case.
    if (recap.beat2) {
      nodes.push({
        key: 'beat2',
        content: <Beat2 beat={recap.beat2} onOpenMap={openMap} />,
      });
    }
    // Beat 3 always renders (no-inviter variant when there is no inviter).
    nodes.push({
      key: 'beat3',
      content: <Beat3 beat={recap.beat3} onInvite={invite} />,
    });
    return nodes;
    // openMap/invite are stable enough for this short-lived overlay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recap]);

  const isEnd = currentIndex >= beats.length;

  function advance() {
    setCurrentIndex((value) => Math.min(value + 1, beats.length));
  }
  function goBack() {
    setCurrentIndex((value) => Math.max(value - 1, 0));
  }
  function done() {
    onDismiss();
    router.push('/');
  }

  // Story-style tap navigation: a tap on the left third steps back, anywhere
  // else advances. Buttons inside beats stopPropagation, so this only fires on
  // the backdrop.
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
      className="fixed inset-0 z-50 grid cursor-pointer place-items-center overflow-hidden bg-stone-950 px-6 py-16 text-stone-50"
      onClick={handleTap}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(245,240,232,0.12),transparent_36%),linear-gradient(180deg,#1c1917_0%,#0c0a09_100%)]" />

      <button
        type="button"
        aria-label="Close"
        className="absolute right-5 top-[max(1.25rem,env(safe-area-inset-top))] z-20 grid size-11 place-items-center rounded-full text-stone-300 transition hover:bg-white/10 hover:text-stone-50"
        onClick={(event) => {
          event.stopPropagation();
          done();
        }}
      >
        <X className="size-7" />
      </button>

      <div key={currentIndex} className="relative z-10 w-full animate-[fadeIn_0.4s_ease]">
        {isEnd ? (
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="font-serif text-4xl font-semibold leading-tight tracking-normal sm:text-6xl">
              Come back {resetDayTime ?? 'tomorrow'} for five new questions.
            </h1>
            <div className="mt-10 flex justify-center">
              <button
                type="button"
                className="inline-flex h-12 items-center justify-center rounded-md bg-stone-100 px-8 text-sm font-medium text-stone-950 transition hover:bg-white"
                onClick={(event) => {
                  event.stopPropagation();
                  done();
                }}
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          beats[currentIndex]!.content
        )}
      </div>

      {!isEnd && beats.length > 0 ? (
        <div
          className="absolute left-0 right-0 z-10 flex justify-center gap-2"
          style={{ bottom: 'max(1.75rem, env(safe-area-inset-bottom))' }}
        >
          {beats.map((beat, index) => (
            <span
              key={beat.key}
              className={
                index === currentIndex
                  ? 'h-2 w-8 rounded-full bg-stone-50'
                  : 'h-2 w-2 rounded-full bg-stone-500'
              }
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
