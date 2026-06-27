'use client';

import { Check, X } from 'lucide-react';
import { useId, useState } from 'react';

import type { RecoveredQuestion } from '@/server/db/queries/recovered-questions';

/**
 * D-REVIEW-RECOVERED-01 (Decision B) — graded, non-persisting review.
 *
 * The player types an answer and submits; the server grades it for real and
 * returns the verdict, which is discarded — nothing is written (see the grade
 * route). The canonical answer is revealed only AFTER a submit (it is never in
 * the page payload), keeping the interaction "recall, then check."
 *
 * Grader-outage handling is mandatory: an `unscored` grade (HTTP 503) surfaces
 * a warm retry note and reveals nothing as wrong — a miss is never shown for an
 * answer the grader couldn't score. Verdicts are distinguished by text + icon,
 * never color alone (canon tripwire).
 */

type Verdict = {
  isCorrect: boolean;
  consolation: string | null;
  correctAnswer: string;
  explanation: string | null;
  creatorNote: string | null;
};

type Phase =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'graded'; verdict: Verdict }
  | { kind: 'retry'; message: string };

export function RecoveredCard({ question }: { question: RecoveredQuestion }) {
  const [value, setValue] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const inputId = useId();

  const loading = phase.kind === 'submitting';

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;
    setPhase({ kind: 'submitting' });
    try {
      const res = await fetch('/api/recovered/grade', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionId: question.questionId, answer: value }),
      });
      if (res.status === 503) {
        const data = await res.json().catch(() => null);
        // Fail toward the player: hold for retry, reveal nothing as wrong.
        setPhase({
          kind: 'retry',
          message:
            (data?.message as string | undefined) ??
            "Couldn't check that just now — give it another go in a moment.",
        });
        return;
      }
      if (!res.ok) {
        setPhase({ kind: 'retry', message: 'Something went sideways. Try once more in a moment.' });
        return;
      }
      const verdict = (await res.json()) as Verdict;
      setPhase({ kind: 'graded', verdict });
    } catch {
      setPhase({ kind: 'retry', message: 'Something went sideways. Try once more in a moment.' });
    }
  }

  const graded = phase.kind === 'graded' ? phase.verdict : null;

  return (
    <article className="card p-4">
      <p className="font-mono text-[0.62rem] uppercase tracking-[0.06em] text-muted-foreground">
        {question.category}
      </p>

      <p className="mt-2 font-serif text-lg font-medium leading-snug text-foreground">
        {question.questionText}
      </p>

      {graded ? (
        <div className="mt-3 space-y-2 text-sm">
          <p className="inline-flex items-center gap-1.5 font-semibold text-foreground">
            {graded.isCorrect ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <X className="size-4" aria-hidden="true" />
            )}
            {graded.isCorrect ? 'You got it' : 'Not quite'}
          </p>
          {!graded.isCorrect && graded.consolation ? (
            <p className="text-muted-foreground">{graded.consolation}</p>
          ) : null}
          <p className="font-medium text-foreground">
            <span className="font-semibold">Answer:</span> {graded.correctAnswer}
          </p>
          {graded.explanation ? (
            <p className="text-muted-foreground">{graded.explanation}</p>
          ) : null}
          {graded.creatorNote ? (
            <p className="text-muted-foreground italic">{graded.creatorNote}</p>
          ) : null}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-3">
          <label htmlFor={inputId} className="sr-only">
            Your answer
          </label>
          <input
            id={inputId}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Recall it, then type your answer…"
            disabled={loading}
            autoComplete="off"
            className="min-h-11 w-full rounded-xl border border-[var(--accent-gold)] bg-[var(--brand-field)] px-4 text-base outline-none focus:border-[var(--brand-navy)] disabled:opacity-60"
          />
          {phase.kind === 'retry' ? (
            <p role="status" aria-live="polite" className="mt-2 text-sm text-muted-foreground">
              {phase.message}
            </p>
          ) : null}
          <button type="submit" disabled={loading || !value.trim()} className="btn-primary mt-3">
            {loading ? 'Checking…' : 'Check my answer'}
          </button>
        </form>
      )}
    </article>
  );
}
