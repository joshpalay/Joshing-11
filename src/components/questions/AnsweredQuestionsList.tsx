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

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

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
        <p className="text-muted-foreground mt-2 max-w-sm text-sm">
          Questions you answer in your feed, daily five, or Joshing games will show up here.
        </p>
      </section>
    );
  }

  return (
    <section>
      <div className="text-muted-foreground hidden grid-cols-[2fr_2fr_1fr_1fr] gap-3 border-b px-3 pb-2 text-xs font-medium tracking-wide uppercase sm:grid">
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
                <p className="text-foreground line-clamp-3">{item.questionText}</p>
              </div>
              <div className="text-sm">
                <span
                  className={
                    answer.muted
                      ? 'text-muted-foreground italic'
                      : correct
                        ? 'text-foreground'
                        : skipped
                          ? 'text-muted-foreground italic'
                          : 'text-foreground decoration-muted-foreground/60 line-through'
                  }
                >
                  {answer.text}
                </span>
                {!answer.muted && !correct && !skipped ? (
                  <span className="text-muted-foreground ml-2 text-xs">
                    correct: {item.correctAnswer}
                  </span>
                ) : null}
                <p className="text-muted-foreground mt-0.5 text-xs sm:hidden">
                  Asked by {askerDisplay(item)} · {formatDate(item.answeredAt)}
                </p>
              </div>
              <div className="text-muted-foreground hidden text-sm sm:block">
                {askerDisplay(item)}
              </div>
              <div className="text-muted-foreground hidden text-sm sm:block">
                {formatDate(item.answeredAt)}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
