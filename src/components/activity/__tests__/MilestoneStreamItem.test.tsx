import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { StreamExpand, StreamQuestion } from '@/lib/activity-stream';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// InlineAnswerFlow is the answerable affordance; mock it to echo "ANSWER THIS
// ONE" with the question text so the test can assert exactly which questions
// remain answerable in the expansion.
vi.mock('@/components/activity/InlineAnswerFlow', () => ({
  InlineAnswerFlow: ({ question }: { question: StreamQuestion }) => (
    <div data-mock="inline-answer">ANSWER THIS ONE → {question.text}</div>
  ),
}));
vi.mock('@/components/SendQuestionDrawer', () => ({
  SendQuestionDrawer: () => <div data-mock="send-drawer" />,
}));
vi.mock('@/app/activities/FriendRequestActions', () => ({
  FriendRequestActions: () => <div data-mock="friend-request" />,
}));
vi.mock('@/app/activities/ReactionGotItButton', () => ({
  ReactionGotItButton: () => <div data-mock="reaction" />,
}));

import { MilestoneExpansion } from '@/components/activity/ActivityStreamItem';

// q-correct: answered right in a prior session. q-wrong: answered WRONG in a
// prior session (the bug — must NOT be answerable here, and the ANSWERED
// history must read "Not this time", not "Correct"). q-fresh: never attempted.
const QUESTIONS: StreamQuestion[] = [
  { questionId: 'q-correct', text: 'Who captains the Enterprise-D?', domain: 'Star Trek', priorResult: 'correct' },
  { questionId: 'q-wrong', text: 'What is a prior inconsistent statement?', domain: 'Mock Trial', priorResult: 'incorrect' },
  { questionId: 'q-fresh', text: 'Name the Enterprise-D android.', domain: 'Star Trek', priorResult: null },
];

const EXPAND: Extract<StreamExpand, { kind: 'milestone' }> = {
  kind: 'milestone',
  friendId: 'friend-1',
  friendName: 'Sadie Brooks',
  questions: QUESTIONS,
};

// Mirrors the seed ActivityStreamItem applies at mount: a question with any
// prior result (right OR wrong) is resolved/locked across reloads.
function renderExpansion() {
  const serverAnswered = new Set(
    QUESTIONS.filter((q) => q.priorResult !== null).map((q) => q.questionId),
  );
  return renderToStaticMarkup(
    <MilestoneExpansion
      expand={EXPAND}
      isResolved={(id) => serverAnswered.has(id)}
      resolutions={new Map()}
      onResolved={() => {}}
    />,
  );
}

describe('MilestoneExpansion — cross-session answer lock', () => {
  it('keeps only never-attempted questions answerable', () => {
    const html = renderExpansion();
    // The fresh question is the only one offered to answer.
    expect(html).toContain('ANSWER THIS ONE → Name the Enterprise-D android.');
    // A prior WRONG answer is NOT answerable again here (the reported bug).
    expect(html).not.toContain('ANSWER THIS ONE → What is a prior inconsistent statement?');
    // A prior CORRECT answer is likewise locked.
    expect(html).not.toContain('ANSWER THIS ONE → Who captains the Enterprise-D?');
  });

  it('reads a prior wrong answer back as "Not this time", not "Correct"', () => {
    const html = renderExpansion();
    expect(html).toContain('ANSWERED');
    expect(html).toContain('Not this time');
    // The wrong question sits in the answered history...
    expect(html).toContain('What is a prior inconsistent statement?');
    // ...and the correct one reads as Correct.
    expect(html).toContain('Correct');
  });
});
