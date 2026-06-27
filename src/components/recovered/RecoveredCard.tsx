import type { RecoveredQuestion } from '@/server/db/queries/recovered-questions';

import { SetAsideButton } from './SetAsideButton';

/**
 * D-REVIEW-RECOVERED-01 (Decision B) — no-check reveal.
 *
 * The player reads the question, recalls the answer in their head, then reveals
 * the canonical answer to check themselves. There is no grader and no verdict:
 * the system never scores what they typed — it just shows the answer. The
 * reveal is a native <details>, server-rendered; the only client JS is the
 * "Set aside" action (SetAsideButton).
 *
 * A set-aside question is demoted to the bottom of the list (ordering lives in
 * the query) and dimmed here, with the action flipped to "Restore".
 */
export function RecoveredCard({ question }: { question: RecoveredQuestion }) {
  return (
    <article className={`card p-4${question.setAside ? ' opacity-60' : ''}`}>
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

      <div className="mt-3 flex justify-end">
        <SetAsideButton questionId={question.questionId} setAside={question.setAside} />
      </div>
    </article>
  );
}
