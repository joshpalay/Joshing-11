'use client';

import type { StreamQuestion } from '@/lib/activity-stream';

import { FM, INK } from '@/components/lately/tokens';

import { useMilestoneAnswer } from './use-milestone-answer';

// D-4 CORRECTION 2 (revised): this drives a single still-unanswered milestone
// question. The opened milestone stacks one of these per unanswered question, so
// the viewer can play any of them; each reads as live and playable (upright navy
// serif, slightly larger, behind a thin left rule) with an inline text action,
// not a boxed button. The grade/result flow itself lives in useMilestoneAnswer,
// shared with the From Friends streak cards (B-FROMFRIENDS-STREAK-HEADER-01); the
// result is reported up only AFTER the feedback pop-up closes, so the parent can
// retire this question into the quiet "Answered" history and the stack above
// shrinks to just the questions still left to play.
export function InlineAnswerFlow({
  question,
  onResolved,
}: {
  question: StreamQuestion;
  onResolved: (questionId: string, submitted: string, isCorrect: boolean) => void;
}) {
  const answer = useMilestoneAnswer(question, onResolved);

  return (
    <div>
      <p
        style={{
          margin: 0,
          paddingRight: 24,
          fontFamily: 'var(--font-serif)',
          fontSize: 17,
          lineHeight: 1.5,
          color: INK,
        }}
      >
        &ldquo;{question.text}&rdquo;
      </p>

      {/* The action sits on the right-hand edge of the question column so it
          reads as the row's trailing affordance, not a left-aligned caption. */}
      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={answer.open}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            background: 'transparent',
            border: 'none',
            borderBottom: `1px solid ${INK}`,
            color: INK,
            fontFamily: FM,
            fontSize: 11,
            letterSpacing: 1.5,
            padding: '0 0 2px',
            cursor: 'pointer',
          }}
        >
          ANSWER →
        </button>
      </div>

      {answer.sheets}
    </div>
  );
}
