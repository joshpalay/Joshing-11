'use client';

export type AnsweredQuestionItem = {
  id: string;
  questionId: string;
  questionText: string;
  submittedAnswer: string | null;
  correctAnswer: string;
  result: 'correct' | 'incorrect' | 'skipped' | null;
  askerName: string;
  answeredAt: string | null;
  sourceLabel: string;
};

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function formatDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : DATE_FORMAT.format(date);
}

function answerDisplay(item: AnsweredQuestionItem): { text: string; muted: boolean } {
  if (item.result === 'skipped') return { text: 'Skipped', muted: true };
  const submitted = item.submittedAnswer?.trim();
  if (!submitted) return { text: '—', muted: true };
  return { text: submitted, muted: false };
}

function askerDisplay(item: AnsweredQuestionItem): string {
  return item.askerName?.trim() || 'Unknown';
}

export function AnsweredQuestionsList({ items }: { items: AnsweredQuestionItem[] }) {
  if (items.length === 0) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center py-16 text-center">
        <h2 className="font-serif text-2xl font-semibold">No answers yet.</h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Questions you answer in your feed, daily five, or Joshing games will show up here.
        </p>
      </section>
    );
  }

  return (
    <section>
      <div className="hidden grid-cols-[2fr_2fr_1fr_1fr] gap-3 border-b px-3 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:grid">
        <div>Question</div>
        <div>Your answer</div>
        <div>Asked by</div>
        <div>Date answered</div>
      </div>
      <ul className="divide-y">
        {items.map((item) => {
          const answer = answerDisplay(item);
          const correct = item.result === 'correct';
          const skipped = item.result === 'skipped';
          return (
            <li
              key={item.id}
              className="grid grid-cols-1 gap-2 px-3 py-3 sm:grid-cols-[2fr_2fr_1fr_1fr] sm:items-start sm:gap-3"
            >
              <div className="text-sm">
                <p className="line-clamp-3 text-foreground">{item.questionText}</p>
              </div>
              <div className="text-sm">
                <span
                  className={
                    answer.muted
                      ? 'italic text-muted-foreground'
                      : correct
                        ? 'text-foreground'
                        : skipped
                          ? 'italic text-muted-foreground'
                          : 'text-foreground line-through decoration-muted-foreground/60'
                  }
                >
                  {answer.text}
                </span>
                {!answer.muted && !correct && !skipped ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    correct: {item.correctAnswer}
                  </span>
                ) : null}
                <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">
                  Asked by {askerDisplay(item)} · {formatDate(item.answeredAt)}
                </p>
              </div>
              <div className="hidden text-sm text-muted-foreground sm:block">
                {askerDisplay(item)}
              </div>
              <div className="hidden text-sm text-muted-foreground sm:block">
                {formatDate(item.answeredAt)}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
