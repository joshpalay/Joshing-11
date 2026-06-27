import type { RecoveredQuestion } from '@/server/db/queries/recovered-questions';

/**
 * D-REVIEW-RECOVERED-01 (Decision B) — no-check reveal.
 *
 * The player reads the question, recalls the answer in their head, then reveals
 * the canonical answer to check themselves. There is no grader and no verdict:
 * the system never scores what they typed — it just shows the answer. The
 * reveal is a native <details>, so this is a pure server component with no
 * client JS and no network round-trip, and the surface mints no writes (see the
 * query module). The answer ships collapsed and is revealed only on demand,
 * keeping the interaction "recall, then check yourself."
 */
export function RecoveredCard({ question }: { question: RecoveredQuestion }) {
  return (
    <article className="card p-4">
      <p className="font-mono text-[0.62rem] uppercase tracking-[0.06em] text-muted-foreground">
        {question.category}
      </p>

      <p className="mt-2 font-serif text-lg font-medium leading-snug text-foreground">
        {question.questionText}
      </p>

      <details className="group mt-3">
        <summary className="btn-primary cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Show answer</span>
          <span className="hidden group-open:inline">Hide answer</span>
        </summary>

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
      </details>
    </article>
  );
}
