import type { RecoveredQuestion } from '@/server/db/queries/recovered-questions';

/**
 * D-REVIEW-RECOVERED-01 (Decision B) — silent self-reveal, no grading.
 *
 * The reveal is a native <details> disclosure: show the question, the player
 * recalls in their head, taps to reveal the canonical answer, self-assesses
 * silently, moves on. Nothing is recorded. This is a server component with no
 * client JS and no network on reveal — read-only by construction, so there is
 * no path through which a `mastery_events` row (or any write) could be minted.
 *
 * No streak / count / progress register, no color-only distinction (canon
 * tripwires): the category eyebrow is text, the reveal is a labelled control.
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

      <details className="group mt-3 text-sm leading-6">
        <summary className="inline-flex cursor-pointer items-center gap-1 font-medium text-foreground underline underline-offset-2">
          <span className="group-open:hidden">Reveal the answer</span>
          <span className="hidden group-open:inline">The answer</span>
        </summary>
        <p className="mt-2 font-medium text-foreground">{question.answerText}</p>
        {question.factualExplanation ? (
          <p className="mt-2 text-muted-foreground">{question.factualExplanation}</p>
        ) : null}
      </details>
    </article>
  );
}
