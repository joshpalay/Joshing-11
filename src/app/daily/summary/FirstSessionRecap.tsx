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
 * Beats: 1) nice start  2) Knowledge tab  3) Questions tab  4) daily rhythm +
 * reminder opt-in. The reminder email opt-in lives here (moved off the
 * onboarding flow) so the ask lands once the player has actually felt the loop.
 *
 * Fires once: the seen-signal is persisted as soon as the overlay mounts, so
 * re-entry/refresh/catch-up never re-trigger it.
 */

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { X } from 'lucide-react';

import { formatNextResetDayTimeLocal } from '@/lib/games/timezone';

// useSyncExternalStore inputs for the client-only reset-time label, mirroring
// the daily summary page: null during SSR keeps hydration stable, and the
// snapshot is read on the client without a setState-in-effect. The label is
// day-aware ("today at 1 PM" / "tomorrow at 1 PM") so the rhythm copy stays
// correct when the next reset falls later on the current local day.
const subscribeNoop = () => () => {};
const getResetTimeSnapshot = () => formatNextResetDayTimeLocal();
const getResetTimeServerSnapshot = (): string | null => null;
import type {
  FirstSessionRecapBeat2,
  FirstSessionRecapView,
} from '@/server/daily/first-session-recap';

const REMINDER_EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export function Beat2({ beat }: { beat: FirstSessionRecapBeat2 }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm tracking-[0.16em] text-stone-400 uppercase">
        Today&rsquo;s five touched
      </p>
      <h1 className="mt-4 font-serif text-4xl leading-tight font-semibold tracking-normal sm:text-6xl">
        {beat.touchedDomains.join(' · ')}
      </h1>
      <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
        Your knowledge map has its first marks.
      </p>
      <p className="mx-auto mt-3 max-w-2xl text-lg leading-8 text-stone-300 sm:text-xl">
        Find your full map any time on the{' '}
        <span className="font-medium text-stone-100">Knowledge</span> tab.
      </p>
    </div>
  );
}

// Beat 3 — mirrors Beat 2's eyebrow → serif headline → supporting line shape,
// pointing at the Questions tab.
export function Beat3() {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm tracking-[0.16em] text-stone-400 uppercase">Your turn</p>
      <h1 className="mt-4 font-serif text-4xl leading-tight font-semibold tracking-normal sm:text-6xl">
        Ask something only you would ask.
      </h1>
      <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
        Write a question for the friends you choose &mdash; that&rsquo;s how the map fills in for
        both of you.
      </p>
      <p className="mx-auto mt-3 max-w-2xl text-lg leading-8 text-stone-300 sm:text-xl">
        Everything you write lives on the{' '}
        <span className="font-medium text-stone-100">Questions</span> tab.
      </p>
    </div>
  );
}

// Beat 4 — daily rhythm + the reminder email opt-in (moved here from onboarding).
// Self-contained state; the form controls stopPropagation so taps don't advance
// the overlay while the player is typing. "Maybe later" / the post-send button
// close straight to the summary; a backdrop tap advances to the end card.
export function Beat4({ onClose }: { onClose: () => void }) {
  const resetDayTime = useSyncExternalStore(
    subscribeNoop,
    getResetTimeSnapshot,
    getResetTimeServerSnapshot,
  );
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<boolean | null>(null);

  async function submit() {
    const trimmed = email.trim();
    if (!REMINDER_EMAIL_FORMAT.test(trimmed)) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const response = await fetch('/api/onboarding/email-reminder', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok !== true) {
        setError(
          typeof data?.message === 'string' ? data.message : "We couldn't save that email. Try again.",
        );
        return;
      }
      setSent(data.sent === true);
    } catch {
      setError("We couldn't save that email. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (sent !== null) {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="font-serif text-4xl leading-tight font-semibold tracking-normal sm:text-6xl">
          {sent ? 'Check your inbox.' : "You're all set."}
        </h1>
        <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
          {sent
            ? 'Tap the confirmation link and your daily reminders switch on automatically.'
            : 'We saved your email but couldn’t send the confirmation just now — you can resend it any time from your profile.'}
        </p>
        <div className="mt-10 flex justify-center" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="inline-flex h-12 items-center justify-center rounded-md bg-stone-100 px-8 text-sm font-medium text-stone-950 transition hover:bg-white"
            onClick={onClose}
          >
            View summary →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm tracking-[0.16em] text-stone-400 uppercase">Every day</p>
      <h1 className="mt-4 font-serif text-4xl leading-tight font-semibold tracking-normal sm:text-6xl">
        Five new questions, every day.
      </h1>
      <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
        Your next five land {resetDayTime ?? 'tomorrow'} &mdash; then a fresh five every day.
      </p>

      <form
        className="mx-auto mt-8 max-w-sm space-y-3 text-left"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!saving) void submit();
        }}
      >
        <p className="text-center text-sm text-stone-400">
          Want a nudge? Drop your email for a daily reminder &mdash; with a no-spoiler peek at your
          next question.
        </p>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          className="h-12 w-full rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-3 text-base text-[var(--brand-navy)] placeholder:text-stone-400 transition outline-none focus:border-[var(--brand-navy)]"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (error) setError(null);
          }}
        />
        {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        <button
          type="submit"
          className="inline-flex h-12 w-full items-center justify-center rounded-md bg-stone-100 px-6 text-sm font-medium text-stone-950 transition hover:bg-white disabled:opacity-50"
          disabled={saving || !REMINDER_EMAIL_FORMAT.test(email.trim())}
        >
          {saving ? 'Sending…' : 'Turn on reminders'}
        </button>
        <button
          type="button"
          className="h-11 w-full text-sm text-stone-400 transition hover:text-stone-200"
          onClick={onClose}
          disabled={saving}
        >
          Maybe later
        </button>
      </form>
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
  const [currentIndex, setCurrentIndex] = useState(0);

  // Persist the seen-signal the moment the recap is shown — re-entry, refresh,
  // and replaying catch-up must never re-trigger it. Fire-and-forget.
  useEffect(() => {
    fetch('/api/daily/first-session-recap/seen', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => undefined);
  }, []);

  const beats = useMemo<BeatNode[]>(() => {
    const nodes: BeatNode[] = [];
    // Beat 1 always renders.
    nodes.push({ key: 'beat1', content: <Beat1 firstName={recap.firstName} /> });
    // Beat 2 omitted only in the defensive empty-session case.
    if (recap.beat2) {
      nodes.push({ key: 'beat2', content: <Beat2 beat={recap.beat2} /> });
    }
    // Beat 3 (Questions tab) and Beat 4 (rhythm + reminders) always render.
    nodes.push({ key: 'beat3', content: <Beat3 /> });
    nodes.push({ key: 'beat4', content: <Beat4 onClose={onDismiss} /> });
    return nodes;
    // onDismiss is stable; recap is the only meaningful input.
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
  }

  // Story-style tap navigation: a tap on the left third steps back, anywhere
  // else advances. Buttons/forms inside beats stopPropagation, so this only
  // fires on the backdrop.
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
        className="absolute top-[max(1.25rem,env(safe-area-inset-top))] right-5 z-20 grid size-11 place-items-center rounded-full text-stone-300 transition hover:bg-white/10 hover:text-stone-50"
        onClick={(event) => {
          event.stopPropagation();
          done();
        }}
      >
        <X className="size-7" />
      </button>

      <div key={currentIndex} className="relative z-10 w-full animate-[fadeIn_0.4s_ease]">
        {isEnd ? (
          <div className="mx-auto max-w-2xl text-center" onClick={(event) => event.stopPropagation()}>
            <p className="text-lg text-stone-300">You&rsquo;re all set.</p>
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                className="inline-flex h-12 items-center justify-center rounded-md bg-stone-100 px-8 text-sm font-medium text-stone-950 transition hover:bg-white"
                onClick={done}
              >
                View summary →
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
