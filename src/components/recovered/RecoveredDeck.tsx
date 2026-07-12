'use client';

import { ArrowDownToLine, Undo2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { RecoveredQuestion } from '@/server/db/queries/recovered-questions';

/**
 * D-REVIEW-RECOVERED-01 (Decision B + revised C) — the one-at-a-time review
 * MODE. The page itself is a landing (count + Start + the dismissed shelf);
 * starting a review opens a full-screen takeover: Cancel (X) in the upper
 * right, the question centered in a scrollable body, and a sticky two-button
 * bar at the bottom — Show/Hide answer and Next — that never moves. The reveal
 * is still no-check (no grader, no verdict); Dismiss takes the question out of
 * circulation via the existing set-aside API, and the dismissed shelf on the
 * landing lists everything dismissed with Restore.
 */

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

type Props = {
  deck: RecoveredQuestion[];
  dismissed: RecoveredQuestion[];
  /** Lower-cased label of the active bounded range ("past week"), or null for all time. */
  rangeLabel: string | null;
};

function RevealBody({ question }: { question: RecoveredQuestion }) {
  return (
    <div className="mt-4 space-y-2 border-t pt-4 text-sm">
      <p className="font-medium text-foreground">
        <span className="font-semibold">Answer:</span> {question.answer}
      </p>
      {question.explanation ? (
        <p className="text-muted-foreground">{question.explanation}</p>
      ) : null}
      {question.creatorNote ? (
        <p className="text-muted-foreground italic">{question.creatorNote}</p>
      ) : null}
    </div>
  );
}

export function RecoveredDeck({ deck: initialDeck, dismissed: initialDismissed, rangeLabel }: Props) {
  const [deck, setDeck] = useState(initialDeck);
  const [dismissed, setDismissed] = useState(initialDismissed);
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);

  const current = playing && index < deck.length ? (deck[index] ?? null) : null;

  // The takeover owns the screen: no background scroll, Escape exits.
  useEffect(() => {
    if (!playing) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPlaying(false);
    }
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [playing]);

  function start() {
    setDeck((d) => shuffle(d)); // a fresh order every session
    setIndex(0);
    setRevealed(false);
    setPlaying(true);
  }

  function exit() {
    setPlaying(false);
  }

  function next() {
    setRevealed(false);
    setIndex((i) => i + 1);
  }

  function goAgain() {
    setDeck((d) => shuffle(d));
    setIndex(0);
    setRevealed(false);
  }

  async function dismissCurrent() {
    if (!current || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/recovered/set-aside', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionId: current.questionId }),
      });
      if (res.ok) {
        setDismissed((d) => [{ ...current, setAside: true }, ...d]);
        // Removing the current card makes `index` point at the next one.
        setDeck((d) => d.filter((q) => q.id !== current.id));
        setRevealed(false);
      }
    } finally {
      setBusy(false);
    }
  }

  async function restore(question: RecoveredQuestion) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/recovered/set-aside', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionId: question.questionId }),
      });
      if (res.ok) {
        setDismissed((d) => d.filter((q) => q.id !== question.id));
        // Back into circulation at the end of the current run-through.
        setDeck((d) => [...d, { ...question, setAside: false }]);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      {/* ── Landing ─────────────────────────────────────────────────────── */}
      {deck.length > 0 ? (
        <section className="card flex flex-col items-start gap-4 p-5">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{deck.length}</span>
            {deck.length === 1 ? ' question' : ' questions'} in circulation
            {rangeLabel ? ` from the ${rangeLabel}` : ''}.
          </p>
          <button type="button" className="btn-primary w-full sm:w-auto" onClick={start}>
            Start revisiting
          </button>
        </section>
      ) : (
        <section className="flex min-h-48 items-center justify-center text-center text-sm text-muted-foreground">
          {initialDeck.length > 0 || (rangeLabel === null && dismissed.length > 0)
            ? 'Everything here is dismissed. Restore one below to put it back in circulation.'
            : rangeLabel
              ? `Nothing turned around in the ${rangeLabel} — try a longer stretch.`
              : // Cold-start register (Decision D): discovery-framed, not a
                // failure / "nothing here" note.
                'The ones you turned around will gather here as you play.'}
        </section>
      )}

      {/* ── Dismissed shelf ─────────────────────────────────────────────── */}
      {dismissed.length > 0 ? (
        <details className="group mt-10">
          <summary className="cursor-pointer select-none list-none font-mono text-[0.62rem] uppercase tracking-[0.06em] text-muted-foreground underline-offset-2 hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span className="underline">Dismissed ({dismissed.length})</span>
          </summary>

          <section className="mt-3 space-y-3">
            {dismissed.map((question) => (
              <article key={question.id} className="card p-4 opacity-60">
                <p className="font-mono text-[0.62rem] uppercase tracking-[0.06em] text-muted-foreground">
                  {question.category}
                </p>

                <p className="mt-2 font-serif text-lg font-medium leading-snug text-foreground">
                  {question.questionText}
                </p>

                <details className="group/answer mt-3">
                  <summary className="cursor-pointer select-none list-none text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground [&::-webkit-details-marker]:hidden">
                    <span className="group-open/answer:hidden">Show answer</span>
                    <span className="hidden group-open/answer:inline">Hide answer</span>
                  </summary>
                  <RevealBody question={question} />
                </details>

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => restore(question)}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                  >
                    <Undo2 className="size-3.5" aria-hidden="true" />
                    Restore
                  </button>
                </div>
              </article>
            ))}
          </section>
        </details>
      ) : null}

      {/* ── Full-screen review mode ─────────────────────────────────────── */}
      {playing ? (
        <div
          className="fixed inset-0 z-[70] flex flex-col bg-background"
          role="dialog"
          aria-modal="true"
          aria-label="Revisit review"
        >
          <header
            className="flex items-center justify-between border-b px-4 py-2"
            style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
          >
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.06em] text-muted-foreground">
              {current ? `${index + 1} of ${deck.length}` : 'Revisit'}
            </p>
            <button type="button" className="btn-icon" aria-label="Exit review" onClick={exit}>
              <X className="size-5" aria-hidden="true" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-8">
            {current ? (
              <div className="mx-auto max-w-2xl">
                <p className="font-mono text-[0.62rem] uppercase tracking-[0.06em] text-muted-foreground">
                  {current.category}
                </p>
                <p className="mt-3 font-serif text-2xl font-medium leading-snug text-foreground">
                  {current.questionText}
                </p>
                {revealed ? <RevealBody question={current} /> : null}
                <div className="mt-8">
                  <button
                    type="button"
                    onClick={dismissCurrent}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                  >
                    <ArrowDownToLine className="size-3.5" aria-hidden="true" />
                    Dismiss — take it out of circulation
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
                {deck.length > 0
                  ? `That’s all ${deck.length} of them — every one a question you turned around.`
                  : 'Nothing left in circulation — everything here is dismissed.'}
              </div>
            )}
          </div>

          {/* Sticky action bar — the two buttons never move. */}
          <footer
            className="border-t bg-background px-4 pt-3"
            style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
          >
            <div className="mx-auto grid max-w-2xl grid-cols-2 gap-3">
              {current ? (
                <>
                  <button
                    type="button"
                    className="btn-ghost min-h-12"
                    onClick={() => setRevealed((r) => !r)}
                  >
                    {revealed ? 'Hide answer' : 'Show answer'}
                  </button>
                  <button type="button" className="btn-primary" onClick={next}>
                    Next
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-ghost min-h-12"
                    onClick={goAgain}
                    disabled={deck.length === 0}
                  >
                    Go again
                  </button>
                  <button type="button" className="btn-primary" onClick={exit}>
                    Done
                  </button>
                </>
              )}
            </div>
          </footer>
        </div>
      ) : null}
    </div>
  );
}
