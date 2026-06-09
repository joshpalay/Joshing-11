import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { convergenceToStreamItem, type StreamExpand } from '@/lib/activity-stream';
import type { Convergence } from '@/lib/convergence';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Heavy children of ActivityStreamItem that a convergence item never renders —
// mocked so the module imports cleanly in the node test environment.
vi.mock('@/components/activity/InlineAnswerFlow', () => ({
  InlineAnswerFlow: () => <div data-mock="inline-answer" />,
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

// Imported AFTER the mocks are registered.
import {
  ActivityStreamItem,
  ConvergenceExpansion,
} from '@/components/activity/ActivityStreamItem';

const CONVERGENCE: Convergence = {
  kind: 'same_correct',
  id: 'converge:F:q1_q2_q3',
  friendId: 'friend-1',
  friendName: 'Robyn Fielding',
  friendFirstName: 'Robyn',
  questionIds: ['q1', 'q2', 'q3'],
  sortAt: new Date('2026-05-20T12:00:00Z'),
};

const QUESTIONS = [
  { questionId: 'q1', text: 'Who painted Guernica?', domain: 'Cubism', priorResult: 'correct' as const },
  { questionId: 'q2', text: 'What is the capital of Mongolia?', domain: 'Geography', priorResult: 'correct' as const },
  { questionId: 'q3', text: 'Who composed The Rite of Spring?', domain: 'Composers', priorResult: 'correct' as const },
];

const CAPTION = 'You and {Name} keep landing in the same place.';

function build() {
  return convergenceToStreamItem(CONVERGENCE, QUESTIONS, CAPTION);
}

describe('convergenceToStreamItem — person-first, Home-eligible, read-only', () => {
  it('builds a person-first headline that names no domain', () => {
    const item = build();
    // The friend is an actor (link) part; the rest is plain copy. No domain
    // ever reaches the headline (no `category` part, no domain string).
    const actorPart = item.line.find((p) => p.t === 'actor');
    expect(actorPart).toMatchObject({ name: 'Robyn', userId: 'friend-1' });
    expect(item.line.some((p) => p.t === 'category')).toBe(false);
    const headlineText = item.line.map((p) => ('v' in p ? p.v : p.name)).join('');
    expect(headlineText).toBe('You and Robyn keep landing in the same place.');
    for (const q of QUESTIONS) {
      expect(headlineText).not.toContain(q.domain);
    }
  });

  it('is Home-eligible (surfaces alongside the triangle rows) and read-only', () => {
    const item = build();
    expect(item.homeEligible).toBe(true);
    expect(item.action).toBeNull();
    expect(item.expand?.kind).toBe('same_correct');
  });

  it('carries the 3 cluster questions in the reveal', () => {
    const item = build();
    expect(item.expand?.kind).toBe('same_correct');
    if (item.expand?.kind !== 'same_correct') throw new Error('expected same_correct');
    expect(item.expand.questions.map((q) => q.questionId)).toEqual(['q1', 'q2', 'q3']);
  });
});

describe('ActivityStreamItem — collapsed convergence one-liner', () => {
  it('renders the person-first line, no expand label, questions hidden', () => {
    const html = renderToStaticMarkup(
      <ActivityStreamItem item={build()} timestamp="2:00 PM" />,
    );
    expect(html).toContain('You and');
    expect(html).toContain('Robyn');
    expect(html).toContain('keep landing in the same place');
    // The "+ QUESTIONS" affordance was removed from the row; the line stays
    // clickable to expand but carries no textual toggle under the timestamp.
    expect(html).not.toContain('+ QUESTIONS');
    // Collapsed: the cluster questions are NOT shown yet.
    expect(html).not.toContain('Who painted Guernica');
    // No domain leaks into the collapsed headline.
    expect(html).not.toContain('Cubism');
  });
});

describe('ConvergenceExpansion — the expanded reveal', () => {
  it('shows the 3 co-correct questions with domains as quiet texture, no actions', () => {
    const item = build();
    if (item.expand?.kind !== 'same_correct') throw new Error('expected same_correct');
    const expand = item.expand as Extract<StreamExpand, { kind: 'same_correct' }>;
    const html = renderToStaticMarkup(<ConvergenceExpansion expand={expand} />);

    // All three questions revealed.
    expect(html).toContain('Who painted Guernica?');
    expect(html).toContain('What is the capital of Mongolia?');
    expect(html).toContain('Who composed The Rite of Spring?');
    // Domains appear here as texture (uppercased), never in the headline.
    expect(html).toContain('CUBISM');

    // Read-only: no answer / send / reaction affordances.
    expect(html).not.toContain('SEND IT ONWARD');
    expect(html).not.toContain('DISCOVER');
    expect(html.toLowerCase()).not.toContain('<button');
  });
});
