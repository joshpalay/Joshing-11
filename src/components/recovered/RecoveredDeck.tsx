'use client';

import { ArrowDownToLine, Undo2 } from 'lucide-react';
import { useState } from 'react';

import type { RecoveredQuestion } from '@/server/db/queries/recovered-questions';

/**
 * D-REVIEW-RECOVERED-01 (Decision B + revised C) — the one-at-a-time review
 * deck. The player sits with one question, recalls the answer in their head,
 * reveals the canonical answer to check themselves (no grader, no verdict),
 * then moves to the next. Dismiss takes a question out of circulation via the
 * existing set-aside API; the dismissed shelf below lists everything dismissed
 * and offers Restore. Deck order arrives pre-shuffled from the server; "Go
 * again" reshuffles client-side.
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
    <div className="mt-3 space-y-2 text-sm">
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
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);

  const current = index < deck.length ? deck[index] : null;
  const finished = deck.length > 0 && current === null;

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
      {current ? (
        <article className="card p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.06em] text-muted-foreground">
              {current.category}
            </p>
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.06em] text-muted-foreground">
              {index + 1} of {deck.length}
            </p>
          </div>

          <p className="mt-2 font-serif text-lg font-medium leading-snug text-foreground">
            {current.questionText}
          </p>

          {revealed ? (
            <>
              <RevealBody question={current} />
              <div className="mt-4">
                <button type="button" className="btn-primary" onClick={next}>
                  Next
                </button>
              </div>
            </>
          ) : (
            <div className="mt-4">
              <button type="button" className="btn-primary" onClick={() => setRevealed(true)}>
                Show answer
              </button>
            </div>
          )}

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={dismissCurrent}
              disabled={busy}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
            >
              <ArrowDownToLine className="size-3.5" aria-hidden="true" />
              Dismiss
            </button>
          </div>
        </article>
      ) : finished ? (
        <section className="flex min-h-48 flex-col items-center justify-center gap-4 text-center text-sm text-muted-foreground">
          <p>
            That&rsquo;s all {deck.length} of them — every one a question you turned around.
          </p>
          <button type="button" className="btn-primary" onClick={goAgain}>
            Shuffle and go again
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
    </div>
  );
}
